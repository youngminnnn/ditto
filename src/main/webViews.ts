import { BrowserWindow, WebContentsView, shell } from 'electron'
import type { WebContents } from 'electron'
import { BROWSER_PARTITION, IPC, PREVIEW_PARTITION } from '@shared/types'
import type { HostedViewKind, HostedViewLayout } from '@shared/types'
import { windowBackgroundColor } from './windows'
import { log } from './logger'

/**
 * 앱이 그리는 웹 콘텐츠(dev 프리뷰·웹 탭)의 소유자.
 *
 * 예전에는 렌더러가 `<webview>` 태그를 놓고 main 이 붙는 순간을 가로채 설정을 강제했다. 그
 * 구조에는 두 가지가 딸려 있었다 — 렌더러가 만든 webContents id 를 main 이 **믿지 않기 위한**
 * 관문이 필요했고, 패널을 분리한 창으로 떼면 태그가 새로 붙어 페이지가 처음부터 다시 로드됐다.
 *
 * 뷰를 main 이 만들면 둘 다 사라진다. 식별자는 우리가 발급한 `tabId` 라 "아무 webContents 나
 * 찍어 달라" 는 요청이 성립하지 않고, 창 사이를 옮기는 것은 부모를 바꾸는 일이라 페이지가 산다.
 *
 * 대신 새로 생기는 값이 하나 있다: **네이티브 뷰는 DOM 위에 그려진다.** 위치·크기는 렌더러가
 * 재서 알려 주고(`lib/hostedView.ts`), 모달 같은 것이 덮을 때는 렌더러가 숨김을 요청한다
 * (`lib/viewSuppress.ts`). 이 파일은 그 지시를 받아 적용하는 쪽이다.
 */

/** http/https 만. file:·about:·custom scheme 은 게스트가 갈 곳이 아니다. */
function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

interface Entry {
  view: WebContentsView
  workspaceId: string
  kind: HostedViewKind
  /** 지금 이 뷰를 붙이고 있는 창. 아무 창에도 안 붙어 있으면 null(정상 상태다 — 아래 참고). */
  ownerWindowId: number | null
  visible: boolean
  /** 마지막으로 화면에 보였던 시각. 동면·축출 판정의 기준이다. */
  lastVisibleAt: number
  /** 캡처·요소 픽커가 잡고 있는 동안 0 보다 크다. 이 사이에는 파괴하지 않는다. */
  busy: number
}

/**
 * 게스트 webContents 에 거는 울타리.
 *
 * `webPreferences` 로 막는 것(preload 미주입·샌드박스·격리)과 달리 이쪽은 **실행 중 행동**을
 * 막는다. 뷰마다 걸어야 한다 — 예전에는 `app.on('web-contents-created')` 하나로 덮었지만,
 * 그건 게스트가 렌더러 손에서 태어났기 때문이었다. 이제 태어나는 자리가 여기 하나뿐이라
 * 생성 경로에서 거는 편이 빠짐이 없다.
 */
export function applyGuestGuards(contents: WebContents): void {
  // 새 창·팝업은 앱 안에 띄우지 않는다 — 주소창도 닫을 방법도 없는 창이 되기 때문이다.
  // 웹 주소면 사용자의 기본 브라우저로 넘긴다(거기엔 주소창이 있다).
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 게스트 안에서의 이동은 웹 주소인 한 자유롭게 둔다(dev 앱의 라우팅이 그렇다).
  // 그 밖의 스킴(file:·custom protocol)은 여기서 막는다.
  contents.on('will-navigate', (event, url) => {
    if (isWebUrl(url)) return
    event.preventDefault()
    log.info(`webViews: blocked navigation to ${url}`)
  })
}

/** 이 종류의 게스트가 쓸 세션 파티션. dev 와 웹을 갈라 쿠키가 서로 새지 않게 한다. */
export function partitionFor(kind: HostedViewKind): string {
  return kind === 'web' ? BROWSER_PARTITION : PREVIEW_PARTITION
}

/** 뷰 하나를 만들 때 강제하는 설정. 예전 `will-attach-webview` 가 하던 일을 그대로 옮겼다. */
function guestWebPreferences(partition: string): Electron.WebPreferences {
  return {
    partition,
    // preload 는 앱의 IPC 표면 그 자체다 — 게스트에 딸려 들어가면 격리가 무의미해진다.
    // 태그 시절에는 렌더러가 적어 둔 값을 지웠지만, 이제는 애초에 넣지 않는다.
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false
  }
}

/**
 * 뷰의 수명에 얹는 배선.
 *
 * 콘솔·네트워크 수집이 여기 붙는다. 예전에는 렌더러가 `dom-ready` 를 보고 "이 게스트를
 * 지켜봐 달라" 고 알려 줬는데, 그건 게스트가 렌더러 손에서 태어났기 때문에 어쩔 수 없던
 * 우회였다 — 첫 콘솔 줄을 놓치지 않으려면 실제 페이지가 로드되기 **전**에 붙어야 하는데,
 * 그 시점을 아는 것은 이제 이쪽이다.
 */
export interface HostedViewHooks {
  onCreated?(tabId: string, workspaceId: string, contents: WebContents): void
  onDestroyed?(tabId: string, workspaceId: string): void
}

export class HostedViewManager {
  private entries = new Map<string, Entry>()

  constructor(
    private dispatch: (channel: string, payload: unknown) => void,
    private hooks: HostedViewHooks = {}
  ) {}

  /**
   * 탭에 뷰를 붙여 준다. 이미 있으면 그대로 쓴다.
   *
   * 탭을 만들었다고 뷰까지 만들지는 않는다 — 뷰 하나가 렌더러 프로세스 하나다. 한 번도 보지
   * 않은 탭에까지 프로세스를 내주면 탭을 쌓아 두는 평범한 사용이 곧 메모리 사고가 된다.
   */
  ensure(tabId: string, workspaceId: string, kind: HostedViewKind, initialUrl?: string): void {
    if (this.entries.has(tabId)) {
      // 이미 있다 — 렌더러가 방금 다시 마운트한 것이다(탭을 오갔거나 창을 옮겼거나). 지금
      // 상태를 한 번 밀어 준다. 이게 없으면 새 화면은 주소도 앞뒤 버튼도 빈 채로 시작하고,
      // **첫 주소를 다시 로드해 보고 있던 페이지를 처음으로 되감는다** — 뷰를 살려 두는
      // 이유가 통째로 사라지는 자리다.
      this.pushState(tabId)
      return
    }

    const view = new WebContentsView({ webPreferences: guestWebPreferences(partitionFor(kind)) })
    // 첫 프레임 전과 리사이즈로 드러나는 가장자리에 흰 판이 번쩍이지 않게 앱 배경을 깔아 둔다.
    view.setBackgroundColor(windowBackgroundColor())
    applyGuestGuards(view.webContents)

    const entry: Entry = {
      view,
      workspaceId,
      kind,
      ownerWindowId: null,
      visible: false,
      lastVisibleAt: Date.now(),
      busy: 0
    }
    this.entries.set(tabId, entry)
    this.watchNavigation(tabId, view.webContents)
    // 첫 loadURL 보다 먼저다 — 이 순서라야 페이지의 첫 콘솔 줄부터 잡힌다.
    this.hooks.onCreated?.(tabId, workspaceId, view.webContents)
    // 첫 주소는 **만든 자리에서만** 넣는다. 렌더러가 판단하면 마운트할 때마다 다시 로드하게
    // 되는데, 뷰가 이미 그 페이지에 있는지 아는 것은 이쪽뿐이다.
    if (initialUrl) this.load(tabId, initialUrl)
  }

  /**
   * 내비게이션 신호를 상태 스냅샷 하나로 접어 렌더러에 민다.
   *
   * 예전에는 렌더러가 여섯 이벤트를 각각 구독해 네 개의 state 로 흩어 놨다. 렌더러는 게스트에
   * 동기 접근을 할 수 없으므로(`canGoBack()` 을 그 자리에서 못 부른다) 어차피 물어봐야 하는데,
   * 그럴 바에는 아는 쪽이 계산해서 한 번에 보내는 편이 맞다.
   */
  private watchNavigation(tabId: string, contents: WebContents): void {
    const push = (): void => this.pushState(tabId)
    contents.on('did-start-loading', push)
    contents.on('did-stop-loading', push)
    contents.on('did-navigate', push)
    contents.on('did-navigate-in-page', push)
    contents.on('dom-ready', push)

    contents.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
      // -3 은 ERR_ABORTED — 사용자가 다음 주소로 넘어가면 이전 로드가 이렇게 끝난다. 실패가 아니다.
      if (errorCode === -3) return
      this.dispatch(IPC.evtHostedView, {
        type: 'fail',
        tabId,
        errorCode,
        errorDescription,
        isMainFrame
      })
    })
  }

  private pushState(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (!entry || entry.view.webContents.isDestroyed()) return
    const wc = entry.view.webContents
    this.dispatch(IPC.evtHostedView, {
      type: 'state',
      tabId,
      url: wc.getURL(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      ready: true
    })
  }

  /**
   * 뷰를 창에 붙인다. 렌더러의 자리표시자가 마운트될 때 불린다.
   *
   * 같은 창에 두 번 붙여도 안전해야 한다 — React 는 개발 모드에서 effect 를 두 번 돌리고,
   * 분리 창을 열고 닫는 동안 순서가 뒤집힐 수도 있다.
   */
  attach(tabId: string, windowId: number): void {
    const entry = this.entries.get(tabId)
    if (!entry) return
    if (entry.ownerWindowId === windowId) return

    this.detach(tabId)
    const win = BrowserWindow.fromId(windowId)
    if (!win || win.isDestroyed()) return
    win.contentView.addChildView(entry.view)
    entry.ownerWindowId = windowId
  }

  /**
   * 창에서 뗀다. 파괴하지 않는다.
   *
   * 어느 창에도 안 붙은 뷰는 **정상 상태**다 — 에이전트가 만든 dev 탭은 사용자가 그 탭을
   * 누르기 전까지 정확히 그 상태이고, 다른 워크스페이스를 보는 동안의 뷰도 그렇다.
   * 붙어 있기만 하고 안 보이는 뷰도 창 컴포지터에 남으므로, 숨길 때는 떼기까지 해야 실효가 있다.
   */
  detach(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (!entry || entry.ownerWindowId === null) return
    const win = BrowserWindow.fromId(entry.ownerWindowId)
    entry.ownerWindowId = null
    if (!win || win.isDestroyed()) return
    win.contentView.removeChildView(entry.view)
  }

  /**
   * 렌더러가 잰 자리를 적용한다.
   *
   * 보낸 창이 그 뷰의 주인일 때만 받는다. 분리 창과 메인 창이 같은 워크스페이스를 그릴 수
   * 있어서, 주인이 아닌 쪽의 좌표를 받으면 뷰가 엉뚱한 창의 레이아웃을 따라간다.
   */
  applyLayout(senderWindowId: number, layouts: readonly HostedViewLayout[]): void {
    const win = BrowserWindow.fromId(senderWindowId)
    if (!win || win.isDestroyed()) return
    const content = win.getContentBounds()

    for (const layout of layouts) {
      const entry = this.entries.get(layout.tabId)
      if (!entry || entry.ownerWindowId !== senderWindowId) continue

      if (!layout.visible) {
        if (entry.visible) {
          entry.view.setVisible(false)
          entry.visible = false
        }
        continue
      }

      // 창 밖으로 나간 좌표는 잘라 낸다. 렌더러가 한 프레임 늦은 값을 보낼 수 있고, 그때
      // 뷰가 창 경계를 넘으면 다른 앱 위에 떠 있는 것처럼 보인다.
      const x = Math.max(0, Math.round(layout.x))
      const y = Math.max(0, Math.round(layout.y))
      entry.view.setBounds({
        x,
        y,
        width: Math.max(0, Math.min(Math.round(layout.width), content.width - x)),
        height: Math.max(0, Math.min(Math.round(layout.height), content.height - y))
      })
      if (!entry.visible) {
        entry.view.setVisible(true)
        entry.visible = true
      }
      entry.lastVisibleAt = Date.now()
    }
  }

  /**
   * 탭이 가리키는 게스트. 캡처·요소 픽커·이슈 수집이 이 관문 하나를 쓴다.
   *
   * `webContents.fromId()` 로 렌더러가 준 숫자를 되찾던 예전 관문을 대체한다 — 여기 있는
   * 것만 우리 뷰이므로, 검증이 곧 조회다.
   */
  resolve(tabId: string): { guest: WebContents } | { error: string } {
    const entry = this.entries.get(tabId)
    if (!entry || entry.view.webContents.isDestroyed())
      return { error: 'The preview is not ready yet.' }
    return { guest: entry.view.webContents }
  }

  /**
   * 이 워크스페이스의 그 종류 뷰. 없으면 null.
   *
   * 에이전트 도구가 쓰는 입구다 — 도구는 tabId 를 모르고 워크스페이스만 안다. 지금은
   * 워크스페이스당 dev 뷰가 하나뿐이라 첫 번째를 돌려주면 되고, 탭이 여럿이 되는 단계에서
   * "활성 탭" 규칙이 여기로 들어온다.
   */
  viewForWorkspace(workspaceId: string, kind: HostedViewKind): WebContents | null {
    const tabId = this.tabIdForWorkspace(workspaceId, kind)
    return tabId ? this.entries.get(tabId)!.view.webContents : null
  }

  /**
   * 그 뷰를 담은 탭의 id. 수집기가 탭 단위로 키를 잡으므로([[main/previewIssues]]) 워크스페이스만
   * 아는 호출자(에이전트 도구)가 이슈를 읽으려면 이 변환이 필요하다.
   */
  tabIdForWorkspace(workspaceId: string, kind: HostedViewKind): string | null {
    for (const [tabId, entry] of this.entries) {
      if (entry.workspaceId !== workspaceId || entry.kind !== kind) continue
      if (entry.view.webContents.isDestroyed()) continue
      return tabId
    }
    return null
  }

  /** 화면에 그려지고 있는가. 캡처는 그려지는 뷰에서만 유효하다. */
  isVisible(tabId: string): boolean {
    const entry = this.entries.get(tabId)
    return !!entry && entry.visible && entry.ownerWindowId !== null
  }

  /** 캡처·픽커가 잡는 동안 파괴를 막는다. 반환값을 부르면 놓는다. */
  hold(tabId: string): () => void {
    const entry = this.entries.get(tabId)
    if (!entry) return () => {}
    entry.busy += 1
    return () => {
      entry.busy = Math.max(0, entry.busy - 1)
    }
  }

  load(tabId: string, url: string): void {
    const target = this.resolve(tabId)
    if ('error' in target) return
    void target.guest.loadURL(url).catch((err) => log.info(`webViews: load failed — ${err}`))
  }

  reload(tabId: string): void {
    const target = this.resolve(tabId)
    if (!('error' in target)) target.guest.reload()
  }

  stop(tabId: string): void {
    const target = this.resolve(tabId)
    if (!('error' in target)) target.guest.stop()
  }

  goBack(tabId: string): void {
    const target = this.resolve(tabId)
    if ('error' in target) return
    if (target.guest.navigationHistory.canGoBack()) target.guest.navigationHistory.goBack()
  }

  goForward(tabId: string): void {
    const target = this.resolve(tabId)
    if ('error' in target) return
    if (target.guest.navigationHistory.canGoForward()) target.guest.navigationHistory.goForward()
  }

  /**
   * 뷰를 없앤다. 탭 레코드는 이 함수가 건드리지 않는다.
   *
   * 탭(영속)과 뷰(캐시)의 수명을 나누는 것이 이 설계의 요점이다 — 예산이 넘치거나 오래 안 본
   * 뷰는 여기서 사라지고, 사용자가 그 탭을 다시 누르면 주소로 되살아난다.
   */
  destroy(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (!entry) return
    if (entry.busy > 0) return
    this.detach(tabId)
    this.entries.delete(tabId)
    this.hooks.onDestroyed?.(tabId, entry.workspaceId)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    this.dispatch(IPC.evtHostedView, { type: 'gone', tabId })
  }

  /** 워크스페이스가 아카이브·삭제될 때 그 아래 뷰를 전부 정리한다. */
  destroyWorkspace(workspaceId: string): void {
    for (const [tabId, entry] of [...this.entries])
      if (entry.workspaceId === workspaceId) this.destroy(tabId)
  }

  /** 창이 닫힐 때 그 창이 붙이고 있던 뷰를 뗀다 — 파괴가 아니다(페이지를 살려 둔다). */
  detachWindow(windowId: number): void {
    for (const [tabId, entry] of this.entries)
      if (entry.ownerWindowId === windowId) {
        entry.ownerWindowId = null
        entry.visible = false
      } else void tabId
  }
}
