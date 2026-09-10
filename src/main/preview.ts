import { session } from 'electron'
import type { WebContents } from 'electron'
import type { HostedViewManager } from './webViews'
import { IPC, PREVIEW_PARTITION } from '@shared/types'
import type { ComposerAttachment, ImageAttachment, PreviewCaptureResult } from '@shared/types'
import { previewLabel } from '@shared/devUrl'
import { formatPickedElement } from '@shared/previewPick'
import { cancelPick, pickElement } from './previewPicker'
import { PreviewIssueCollector } from './previewIssues'
import { log } from './logger'

/**
 * Preview 의 main 쪽 배선 — 세션 권한, 캡처, 요소 픽커.
 *
 * 게스트를 못 믿는다는 전제는 그대로지만, 그 울타리는 이제 여기 없다. 뷰를 main 이 만들므로
 * 격리 설정은 생성 시점에 한 번 박히고([[main/webViews]]), 렌더러가 적어 둔 값을 뒤늦게 다시
 * 강제할 일 자체가 없어졌다. 남은 것은 세션 단위 정책(권한 거부)과, 게스트를 가지고 하는
 * 일(캡처·픽커)이다.
 */

/**
 * 캡처 이미지의 가로 상한(px). Retina 에서 전체 페이지를 그대로 뜨면 3000px 을 넘고, base64 로
 * 컴포저·IPC·모델 입력까지 그 크기가 따라간다. 화면을 알아볼 수 있으면 되는 용도라 여기서 줄인다.
 */
const MAX_CAPTURE_WIDTH = 1600

/**
 * 콘솔·네트워크 문제 수집기. main 이 소유하고 개수만 렌더러로 흘린다([[previewIssues]]).
 * 모듈 수준에 두는 이유는 세션 배선(webRequest)이 앱 전체에 하나뿐이기 때문이다.
 */
let issues: PreviewIssueCollector

/** 수집기 접근자 — ipc 계층이 목록 조회·비우기·회신에 쓴다. */
export function previewIssues(): PreviewIssueCollector {
  return issues
}

/**
 * 렌더러로 이벤트를 보내는 통로(initPreview 가 받아 둔다).
 *
 * ipc 계층이 아니라 여기에도 들고 있는 이유는 에이전트 도구 때문이다 — 도구는 메인에서 돌지만
 * Preview 탭을 여는 것은 렌더러의 일이라, 사람이 누르는 "Open in Preview" 와 **같은 방송**을
 * 도구도 쓸 수 있어야 한다([[agent/tools/preview]]).
 */
let dispatchToRenderer: (channel: string, payload: unknown) => void = () => {}

/** 뷰 소유자. 캡처·픽커가 tabId 로 게스트를 찾을 때 쓴다. */
let views: HostedViewManager

/** Preview 세션 정책을 세운다(앱 기동 시 1회). 게스트 울타리는 webViews 가 생성 시점에 건다. */
export function initPreview(
  dispatch: (channel: string, payload: unknown) => void,
  hostedViews: HostedViewManager
): void {
  dispatchToRenderer = dispatch
  views = hostedViews
  issues = new PreviewIssueCollector(dispatch)
  issues.initSession()

  const previewSession = session.fromPartition(PREVIEW_PARTITION)
  // 미리보는 페이지에 카메라·마이크·알림·위치를 줄 이유가 없다. 물어보지도 않고 전부 거절한다.
  previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  previewSession.setPermissionCheckHandler(() => false)
}

/** Preview 화면을 PNG 로 캡처한다. */
export async function capturePreview(
  url: string,
  tabId: string
): Promise<PreviewCaptureResult & { image?: ImageAttachment }> {
  const target = views.resolve(tabId)
  if ('error' in target) return target

  // 찍는 동안은 붙잡아 둔다 — 뷰 예산이 하필 이 순간 이 뷰를 골라 정리하면 캡처가 "왜 실패했는지
  // 알 수 없는" 실패가 된다([[main/webViews]] evict).
  const release = views.hold(tabId)
  try {
    let image = await target.guest.capturePage()
    if (image.isEmpty()) return { error: 'There is nothing to capture yet.' }
    if (image.getSize().width > MAX_CAPTURE_WIDTH)
      image = image.resize({ width: MAX_CAPTURE_WIDTH })
    return {
      image: {
        name: `preview-${previewLabel(url)}.png`,
        mediaType: 'image/png',
        dataBase64: image.toPNG().toString('base64')
      }
    }
  } catch (err) {
    log.error('preview: capturePage failed', err)
    return { error: err instanceof Error ? err.message : 'Could not capture the preview.' }
  } finally {
    release()
  }
}

/**
 * 요소 픽커를 켜고, 사용자가 고른 요소를 컴포저에 넣을 형태로 만들어 돌려준다.
 *
 * 그림과 설명을 **한 건**으로 묶어 내보내는 것이 요점이다([[shared/types]] ComposerAttachment) —
 * 크롭 이미지와 그 요소의 HTML·CSS 는 짝이라, 따로 흘려보내면 컴포저에서 순서가 갈린다.
 */
export async function pickPreviewElement(
  url: string,
  tabId: string
): Promise<PreviewCaptureResult & { attachment?: ComposerAttachment }> {
  const target = views.resolve(tabId)
  if ('error' in target) return target

  // 사용자가 요소를 고르는 동안 뷰가 사라지면 CDP 세션이 매달린다 — 그동안 붙잡아 둔다.
  const release = views.hold(tabId)
  let picked: Awaited<ReturnType<typeof pickElement>>
  try {
    picked = await pickElement(target.guest)
  } finally {
    release()
  }
  if ('error' in picked) return picked

  return {
    attachment: {
      text: formatPickedElement(picked, url),
      ...(picked.cropBase64
        ? {
            image: {
              name: `element-${previewLabel(url)}.png`,
              mediaType: 'image/png',
              dataBase64: picked.cropBase64
            }
          }
        : {})
    }
  }
}

/** 진행 중인 픽을 취소한다. 그 탭의 뷰가 없으면 아무 일도 하지 않는다. */
export function cancelPreviewPick(tabId: string): void {
  const target = views.resolve(tabId)
  if ('error' in target) return
  cancelPick(target.guest.id)
}

// ── 에이전트가 쓰는 입구 ────────────────────────────────────────────────────

/**
 * 이 워크스페이스의 dev 게스트. 없으면 null — 그 탭의 뷰가 아직 만들어지지 않았다는 뜻이다.
 *
 * 예전에는 렌더러가 `dom-ready` 에서 알려 준 것을 맵에 적어 뒀다. 게스트가 렌더러 손에서
 * 태어나던 시절의 우회였고, 그래서 "등록을 빠뜨리면 도구가 조용히 못 찾는다" 는 함정이
 * 있었다. 이제는 뷰를 만든 쪽이 곧 아는 쪽이라 맵이 필요 없다.
 */
export function previewGuestFor(workspaceId: string): WebContents | null {
  return views.viewForWorkspace(workspaceId, 'dev')
}

/** 그 프리뷰를 담은 탭의 id. 콘솔·네트워크 문제가 탭 단위로 모이므로 조회에 이것이 필요하다. */
export function previewTabFor(workspaceId: string): string | null {
  return views.tabIdForWorkspace(workspaceId, 'dev')
}

/**
 * Preview 탭을 열라고 모든 창에 방송한다. 사람이 누르는 "Open in Preview" 와 같은 신호다.
 *
 * `url` 이 비면 탭만 열고 이동은 하지 않는다 — 에이전트 경로에서는 이동을 메인이 직접 하기
 * 때문이다([[agent/tools/preview]]). 렌더러와 메인이 같은 게스트에 각자 loadURL 을 걸면 서로를
 * ERR_ABORTED 로 끊어, "열었는데 왜 실패했는지" 를 아무도 정확히 말할 수 없게 된다.
 */
export function requestPreviewOpen(workspaceId: string, url: string, activate: boolean): void {
  dispatchToRenderer(IPC.evtPreviewOpen, { workspaceId, url, activate })
}

/**
 * 에이전트에게 돌려줄 캡처의 base64 상한. 이미지는 잘라 낼 수가 없으므로(반쪽 PNG 는 그림이
 * 아니다) 상한을 넘으면 **줄인다**. 줄였다는 사실은 결과에 적어 보낸다.
 */
const MAX_AGENT_CAPTURE_BASE64 = 1_000_000

/** 상한에 맞출 때까지 차례로 내려가 볼 가로 크기(px). 첫 값이 기본 해상도다. */
const AGENT_CAPTURE_WIDTHS = [1280, 1024, 768, 512]

export interface AgentCapture {
  dataBase64: string
  width: number
  height: number
  /** 상한에 맞추려고 줄였다면 원래 크기. 안 줄였으면 없다. */
  scaledFrom?: { width: number; height: number }
}

/**
 * 에이전트에게 돌려줄 화면을 찍는다.
 *
 * 사람용 캡처(capturePreview)와 나눠 둔 이유는 예산이 다르기 때문이다. 사람 쪽은 컴포저에
 * 붙어 사용자가 보고 지울 수 있지만, 이쪽은 모델의 컨텍스트에 그대로 들어가 그 세션의 남은
 * 요청마다 다시 실린다 — 큰 그림 한 장의 값이 한 번이 아니다.
 */
export async function captureForAgent(
  guest: WebContents
): Promise<{ capture: AgentCapture } | { error: string }> {
  try {
    const shot = await guest.capturePage()
    const original = shot.getSize()
    if (shot.isEmpty() || original.width === 0 || original.height === 0) {
      return {
        error:
          'The preview rendered nothing to capture. Wooi only paints the preview while its tab ' +
          'is on screen, so this usually means the user moved to another tab or workspace.'
      }
    }

    // 원본보다 크게 늘리지 않는다 — 확대는 정보를 더하지 않고 바이트만 늘린다. 원본이 첫
    // 단계보다 이미 작으면 사다리는 비고, 그때는 원본 크기 하나만 시도한다.
    const ladder = AGENT_CAPTURE_WIDTHS.filter((w) => w < original.width)
    let chosen = shot
    let dataBase64 = ''
    for (const width of ladder.length ? ladder : [original.width]) {
      chosen = width === original.width ? shot : shot.resize({ width })
      dataBase64 = chosen.toPNG().toString('base64')
      if (dataBase64.length <= MAX_AGENT_CAPTURE_BASE64) break
    }

    const size = chosen.getSize()
    return {
      capture: {
        dataBase64,
        width: size.width,
        height: size.height,
        ...(size.width < original.width ? { scaledFrom: original } : {})
      }
    }
  } catch (err) {
    log.error('preview: agent capturePage failed', err)
    return { error: err instanceof Error ? err.message : 'Could not capture the preview.' }
  }
}
