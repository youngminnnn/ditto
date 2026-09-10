import { session } from 'electron'
import type { WebContents } from 'electron'
import { BROWSER_PARTITION, IPC, PREVIEW_PARTITION } from '@shared/types'
import { addIssue, countIssues, type PreviewIssue } from '@shared/previewIssues'
import { log } from './logger'

type Dispatch = (channel: string, payload: unknown) => void

/**
 * Preview 가 띄운 페이지의 콘솔 에러와 실패한 요청을 모은다.
 *
 * **CDP 를 쓰지 않는다.** 요소 픽커([[previewPicker]])가 debugger 를 쓰는데, `debugger.attach` 는
 * webContents 당 하나뿐이라 여기서도 붙잡고 있으면 둘이 서로를 끊는다. 게다가 이건 Preview 가
 * 열려 있는 내내 돌아야 하므로, 붙여 두는 동안 사용자가 게스트의 DevTools 를 영영 못 열게 된다.
 * 콘솔은 `console-message` 이벤트로, 네트워크는 세션의 webRequest 로 충분히 얻어진다 —
 * 스택 트레이스는 못 얻지만 `파일:줄` 은 나오고, 그 대가로 픽커·DevTools 와 공존한다.
 *
 * 렌더러로는 **개수만** 흘린다. 매 콘솔 줄을 IPC 로 밀면 스크립트 출력에서 겪은 것과 같은 일이
 * 벌어진다 — 폭주하는 로그가 메시지 홍수가 되어 메인 힙을 밀어 올린다([[scripts]] 의 코얼레싱).
 * 목록 자체는 사용자가 패널을 열 때 한 번 가져간다.
 *
 * **키는 워크스페이스가 아니라 tabId 다.** 한 워크스페이스에 뷰가 여럿(탭)이 되면서, 워크스페이스
 * 단위로 잡던 키는 "탭 A 에서 새 페이지로 가면 탭 B·C 의 문제까지 지워진다" 는 버그가 된다
 * (`did-navigate` 가 `clear` 를 부르는데, 그 인자가 워크스페이스였다). `ofWorkspace` 는 그
 * workspaceId 를 잃지 않으려고 남겨 둔 곁가지 맵이다 — 방송 페이로드에 워크스페이스를 실어야
 * 사이드바 배지가 조회 테이블 없이 그려지고(나중 작업), `disposeWorkspace` 가 워크스페이스
 * 전체를 정리할 때 그 아래 tabId 를 찾는 데도 쓰인다.
 */

/** 탭당 보관할 문제의 최대 개수. 넘으면 오래된 것부터 버린다. */
const LIMIT = 200

/** 개수 방송을 모아 보내는 주기(ms). 렌더 폭풍을 막는 최소한의 간격. */
const NOTIFY_INTERVAL_MS = 400

/** 이 리소스 종류의 실패는 세지 않는다 — 페이지 동작과 무관하게 늘 실패하는 것들이다. */
const IGNORED_RESOURCES = new Set(['ping', 'cspReport'])

/**
 * 사용자가 취소했거나 우리가 이동시킨 요청. 실패로 보여 주면 "새로고침할 때마다 에러가 뜬다" 가
 * 된다 — 개발자가 고칠 것이 아무것도 없는 에러다.
 */
const IGNORED_NET_ERRORS = new Set(['net::ERR_ABORTED', 'net::ERR_BLOCKED_BY_CLIENT'])

export class PreviewIssueCollector {
  /** 탭별 문제 목록. */
  private issues = new Map<string /*tabId*/, PreviewIssue[]>()
  /** 게스트 webContents id → tabId. webRequest 는 이걸로 요청의 주인을 찾는다. */
  private owner = new Map<number /*webContentsId*/, string /*tabId*/>()
  /** tabId → workspaceId. 방송 페이로드에 워크스페이스를 실어 보내고, 워크스페이스 통째
   *  정리(`disposeWorkspace`) 할 때 그 아래 tabId 를 찾는 데 쓴다. */
  private ofWorkspace = new Map<string /*tabId*/, string /*workspaceId*/>()
  /** 게스트별로 걸어 둔 정리 함수(리스너 해제). */
  private cleanups = new Map<number, () => void>()
  /** 방송이 예약된 탭(모아 보내기). */
  private pending = new Set<string>()
  private notifyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private dispatch: Dispatch) {}

  /**
   * 세션 단위 배선(앱 기동 시 1회). 네트워크 실패는 webContents 가 아니라 **세션**에서 오므로,
   * Preview 파티션에 한 번만 걸고 요청의 webContentsId 로 주인을 되찾는다.
   */
  initSession(): void {
    // dev 와 웹은 파티션이 다르다([[shared/types]] BROWSER_PARTITION) — 둘 다 걸어야 웹 탭의
    // 404·연결 실패도 같은 배지에 모인다. 콘솔은 webContents 단위라 여기와 무관하다.
    for (const partition of [PREVIEW_PARTITION, BROWSER_PARTITION])
      this.watchSession(session.fromPartition(partition))
  }

  private watchSession(target: Electron.Session): void {
    const wr = target.webRequest

    wr.onErrorOccurred((details) => {
      if (IGNORED_RESOURCES.has(details.resourceType)) return
      if (IGNORED_NET_ERRORS.has(details.error)) return
      const tabId = details.webContentsId && this.owner.get(details.webContentsId)
      if (!tabId) return
      this.add(tabId, {
        kind: 'network',
        level: 'error',
        text: `${details.error} ${details.method} ${short(details.url)}`,
        source: details.url,
        ts: Date.now()
      })
    })

    wr.onCompleted((details) => {
      if (details.statusCode < 400) return
      if (IGNORED_RESOURCES.has(details.resourceType)) return
      const tabId = details.webContentsId && this.owner.get(details.webContentsId)
      if (!tabId) return
      this.add(tabId, {
        kind: 'network',
        // 4xx 는 앱이 잘못 부른 것일 수도, 정상 흐름(401 로 로그인 유도)일 수도 있다 — 경고로,
        // 5xx 는 서버가 터진 것이므로 에러로 본다.
        level: details.statusCode >= 500 ? 'error' : 'warning',
        text: `${details.statusCode} ${details.method} ${short(details.url)}`,
        source: details.url,
        ts: Date.now()
      })
    })
  }

  /**
   * 이 게스트가 어느 탭·워크스페이스의 것인지 알려 주고 콘솔 수집을 시작한다.
   * webViews 가 뷰를 만드는 즉시 부른다 — 첫 loadURL 보다 먼저라 실제 페이지가 로드되기 전이라
   * 첫 콘솔 줄부터 놓치지 않는다.
   */
  watch(tabId: string, workspaceId: string, guest: WebContents): void {
    const id = guest.id
    this.unwatch(tabId)
    this.owner.set(id, tabId)
    this.ofWorkspace.set(tabId, workspaceId)

    // 메시지 필드는 **첫 인자**(이벤트 객체)에 실려 온다 — 옛 시그니처의 (event, level, …) 가
    // 아니다. 두 번째 인자를 읽으면 조용히 아무것도 안 잡힌다(그렇게 한 번 틀렸다).
    const onConsole = (e: ConsoleParams): void => {
      if (e.level !== 'error' && e.level !== 'warning') return
      // Electron 이 게스트에 직접 찍는 경고는 사용자의 앱 코드가 아니다. 특히 dev 에서는
      // "이 페이지에 CSP 가 없다" 경고가 **매 페이지마다** 뜨는데, 그건 우리가 Preview 파티션에
      // 일부러 CSP 를 씌우지 않아서다([[main/preview]]) — 개발자가 고칠 것이 아무것도 없다.
      if (e.sourceId?.startsWith('node:electron/')) return
      this.add(tabId, {
        kind: 'console',
        level: e.level,
        text: e.message,
        source: e.sourceId ? `${short(e.sourceId)}:${e.lineNumber}` : undefined,
        ts: Date.now()
      })
    }

    // 새 페이지로 가면 이전 페이지의 문제는 접어 둔다 — 안 지우면 "고쳤는데도 그대로다" 로 보인다.
    // 같은 페이지 안의 라우팅(did-navigate-in-page)은 새 페이지가 아니므로 그대로 둔다.
    // tabId 로 지우는 것이 이번 재키잉의 요점이다 — 예전에는 workspaceId 로 지웠는데, 그러면
    // 이 탭의 이동이 같은 워크스페이스의 다른 탭 이슈까지 같이 지웠다.
    const onNavigate = (): void => this.clear(tabId)
    const onDestroyed = (): void => this.unwatch(tabId)

    guest.on('console-message', onConsole as never)
    guest.on('did-navigate', onNavigate)
    guest.once('destroyed', onDestroyed)

    this.cleanups.set(id, () => {
      // 게스트가 이미 죽었으면 리스너 해제도 던질 수 있다 — 정리가 흐름을 끊지 않게 감싼다.
      try {
        guest.removeListener('console-message', onConsole as never)
        guest.removeListener('did-navigate', onNavigate)
        guest.removeListener('destroyed', onDestroyed)
      } catch (err) {
        log.error('preview: issue listener cleanup failed', err)
      }
    })
  }

  /** 이 탭의 수집을 멈춘다(뷰가 파괴됐거나 다시 watch 하기 전 정리). 모아 둔 문제는 남긴다 —
   *  뷰가 캐시 축출로 사라졌다가 다시 만들어지는 흔한 경우, 이전 문제가 사라지면 안 된다. */
  unwatch(tabId: string): void {
    for (const [webContentsId, owner] of this.owner) {
      if (owner !== tabId) continue
      this.cleanups.get(webContentsId)?.()
      this.cleanups.delete(webContentsId)
      this.owner.delete(webContentsId)
      break
    }
  }

  list(tabId: string): PreviewIssue[] {
    return this.issues.get(tabId) ?? []
  }

  clear(tabId: string): void {
    if (!this.issues.has(tabId)) return
    this.issues.delete(tabId)
    this.scheduleNotify(tabId)
  }

  /** 이 탭의 에러/경고 개수. */
  countIssues(tabId: string): { errors: number; warnings: number } {
    return countIssues(this.list(tabId))
  }

  /** 워크스페이스가 사라질 때 그 아래 탭을 모두 정리한다. */
  disposeWorkspace(workspaceId: string): void {
    for (const [tabId, owner] of [...this.ofWorkspace]) {
      if (owner !== workspaceId) continue
      this.issues.delete(tabId)
      this.unwatch(tabId)
      this.ofWorkspace.delete(tabId)
    }
  }

  private add(tabId: string, incoming: Omit<PreviewIssue, 'id' | 'count'>): void {
    this.issues.set(tabId, addIssue(this.list(tabId), incoming, LIMIT))
    this.scheduleNotify(tabId)
  }

  /** 개수 방송을 예약한다. 이미 예약돼 있으면 거기에 묻어 간다. */
  private scheduleNotify(tabId: string): void {
    this.pending.add(tabId)
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      const ids = [...this.pending]
      this.pending.clear()
      for (const id of ids) {
        // 이미 disposeWorkspace 로 정리된 탭이면 워크스페이스를 잃어 방송할 대상이 없다.
        const workspaceId = this.ofWorkspace.get(id)
        if (!workspaceId) continue
        this.dispatch(IPC.evtPreviewIssues, { tabId: id, workspaceId, ...this.countIssues(id) })
      }
    }, NOTIFY_INTERVAL_MS)
  }
}

interface ConsoleParams {
  message: string
  level: 'info' | 'warning' | 'error' | 'debug'
  lineNumber: number
  sourceId: string
}

/** 긴 URL 은 목록에서 한 줄을 통째로 잡아먹는다 — 가운데를 접는다. */
function short(url: string, max = 120): string {
  if (url.length <= max) return url
  return `${url.slice(0, max - 30)}…${url.slice(-25)}`
}
