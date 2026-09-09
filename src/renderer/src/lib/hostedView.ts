import { useEffect, useRef, useState } from 'react'
import type {
  HostedViewEvent,
  HostedViewKind,
  HostedViewLayout,
  HostedViewState
} from '@shared/types'
import { isViewSuppressed } from './viewSuppress'

/**
 * 얹은 웹 뷰(dev 프리뷰·웹 탭)를 렌더러 레이아웃에 묶는다.
 *
 * 뷰는 main 이 소유하고 DOM 밖에서 그려지므로, **어디에 얼마나** 그릴지는 여기서 재서 알려
 * 줘야 한다. 재는 방법으로 이벤트 구독을 쓰지 않는다 — `lib/anchor.ts` 가 같은 문제에서 이미
 * 같은 결론에 도달했고, 그 주석에 회귀 사례까지 남아 있다. 실제로 이벤트로는 못 잡는 경로가
 * 여럿이다:
 *
 * - 프리뷰 자신의 크롬이 늘고 줄 때(픽커 배너·콘솔 목록) — 순수 DOM 변화라 창에도 스토어에도
 *   신호가 없다
 * - 상단 배너(공지·업데이트·에이전트 없음)가 떴다 사라질 때 — 세로 오프셋이 통째로 밀리는데
 *   창 크기는 그대로다
 * - 컨테이너 쿼리로 헤더가 줄바꿈할 때
 *
 * 프레임마다 재고 **바뀐 것만** 보낸다. 유휴 상태에서는 IPC 가 0건이라 비용이 없고, 분할바를
 * 끄는 동안에는 rAF 가 주사율에서 캡을 걸어 준다. 디바운스는 넣지 않는다 — 뷰가 분할바보다
 * 늦게 따라오는 쪽이 더 나쁜 증상이다.
 */

interface Registration {
  el: HTMLElement
  /** 호출부가 끄는 스위치(예: 빈 화면·실패 화면을 그리는 동안). 측정 결과와 AND 된다. */
  enabled: boolean
  last?: HostedViewLayout
}

/** 등록된 자리표시자 전부. 루프는 **하나**다 — 탭 여섯 개여도 프레임당 rAF 한 번이다. */
const registry = new Map<string, Registration>()
let raf = 0

function sameLayout(a: HostedViewLayout | undefined, b: HostedViewLayout): boolean {
  if (!a) return false
  if (!a.visible && !b.visible) return true
  return (
    a.visible === b.visible &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  )
}

function measure(tabId: string, reg: Registration): HostedViewLayout {
  const box = reg.el.getBoundingClientRect()
  // 자리를 못 재면(감춰진 탭이라 0×0, 화면 밖) **숨긴다.** 보이는 채로 엉뚱한 자리에 남는
  // 것보다 낫다 — 그쪽은 사용자가 앱이 깨졌다고 느끼는 실패 모드다.
  const drawable = reg.enabled && box.width > 0 && box.height > 0 && !isViewSuppressed(box)
  return {
    tabId,
    x: Math.round(box.left),
    y: Math.round(box.top),
    width: Math.round(box.width),
    height: Math.round(box.height),
    visible: drawable
  }
}

function tick(): void {
  const changed: HostedViewLayout[] = []
  for (const [tabId, reg] of registry) {
    const next = measure(tabId, reg)
    if (sameLayout(reg.last, next)) continue
    reg.last = next
    changed.push(next)
  }
  if (changed.length > 0) window.api.views.setLayout(changed)
  raf = requestAnimationFrame(tick)
}

function startLoop(): void {
  if (raf) return
  raf = requestAnimationFrame(tick)
}

function stopLoopIfIdle(): void {
  if (registry.size > 0 || !raf) return
  cancelAnimationFrame(raf)
  raf = 0
}

/**
 * 자리표시자를 이 탭의 뷰에 묶는다.
 *
 * 반환한 `ref` 를 빈 `<div>` 에 걸면 그 자리에 뷰가 뜬다. 자리표시자가 언마운트되면 뷰는
 * 창에서 떨어지지만 **파괴되지는 않는다** — 워크스페이스를 옮겼다 돌아왔을 때 페이지가
 * 처음부터 다시 로드되지 않는 이유가 이것이다.
 */
export function useHostedView(opts: {
  /** null 이면 아무것도 하지 않는다(탭이 아직 없을 때). */
  tabId: string | null
  workspaceId: string
  kind: HostedViewKind
  /** 거짓이면 뷰를 숨긴다 — 빈 화면·실패 화면을 그 자리에 그리는 동안. */
  enabled?: boolean
}): {
  ref: React.RefObject<HTMLDivElement | null>
  state: HostedViewState | null
  /** 메인 프레임 로드 실패. 다음 로드가 시작되면 저절로 지워진다. */
  failure: string | null
  /**
   * 뷰가 만들어져 명령을 받을 준비가 됐는가.
   *
   * `state` 로는 알 수 없다 — 갓 만든 뷰는 아직 아무 데도 가지 않아서 내비게이션 이벤트가
   * 하나도 없고, 따라서 `state` 가 null 인 채로 남는다. 첫 주소를 언제 밀어 넣을지 아는
   * 신호가 따로 필요하다.
   */
  attached: boolean
} {
  const { tabId, workspaceId, kind, enabled = true } = opts
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<HostedViewState | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attached, setAttached] = useState(false)

  // main 이 접어 보내는 상태 스냅샷. 이벤트 여섯 개를 각각 구독하던 것을 하나로 줄인 자리다.
  useEffect(() => {
    if (!tabId) return
    return window.api.views.onEvent((e: HostedViewEvent) => {
      if (e.tabId !== tabId) return
      if (e.type === 'state') {
        setState(e)
        // 다음 로드가 시작되면 지난 실패는 더 이상 화면을 덮지 않아야 한다.
        if (e.loading) setFailure(null)
      } else if (e.type === 'fail') {
        // 서브리소스 실패(이미지 404 등)로 화면 전체를 에러로 덮지 않는다.
        if (e.isMainFrame) setFailure(e.errorDescription || `Load failed (${e.errorCode})`)
      }
      // 뷰가 동면·크래시로 사라지면 화면은 "다시 열기" 를 그려야 한다. 빈 화면으로 두면
      // 사용자는 페이지가 로드에 실패했다고 읽는다.
      else if (e.type === 'gone') {
        setState(null)
        setFailure(null)
      }
    })
  }, [tabId])

  useEffect(() => {
    const el = ref.current
    if (!tabId || !el) return

    let cancelled = false
    void window.api.views.ensure(tabId, workspaceId, kind).then(async () => {
      if (cancelled) return
      // attach 는 ensure 뒤에 와야 한다 — 아직 없는 뷰는 붙일 수 없다.
      await window.api.views.attach(tabId)
      if (!cancelled) setAttached(true)
    })

    registry.set(tabId, { el, enabled })
    startLoop()

    return () => {
      cancelled = true
      setAttached(false)
      registry.delete(tabId)
      stopLoopIfIdle()
      void window.api.views.detach(tabId)
    }
  }, [tabId, workspaceId, kind])

  // `enabled` 는 등록을 다시 만들지 않고 값만 바꾼다 — 껐다 켤 때마다 attach/detach 가 돌면
  // 뷰가 창에서 떨어졌다 붙으며 깜빡인다.
  useEffect(() => {
    if (!tabId) return
    const reg = registry.get(tabId)
    if (reg) reg.enabled = enabled
  }, [tabId, enabled])

  return { ref, state, failure, attached }
}

/** 테스트용 — 케이스 사이에 루프와 등록이 새지 않게 한다. */
export function resetHostedViews(): void {
  registry.clear()
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}
