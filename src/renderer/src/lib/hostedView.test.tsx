import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostedViewLayout } from '@shared/types'
import { fakeApi } from '../test/fakeApi'
import { resetHostedViews, useHostedView } from './hostedView'
import { resetViewSuppression, suppressAllViews } from './viewSuppress'

/**
 * 이 훅의 값어치는 전부 "언제 IPC 를 보내지 **않는가**" 에 있다.
 *
 * 프레임마다 재는 설계라 자칫하면 유휴 상태에서도 초당 60건이 나간다. 그래서 여기 있는 단언
 * 대부분은 "안 불렸다" 쪽이다 — 그게 깨지면 기능은 멀쩡해 보이면서 앱이 조용히 느려진다.
 */

let nextFrameId = 1
const pendingFrames = new Map<number, FrameRequestCallback>()

/** 예약된 프레임을 한 번 굴린다. tick 이 다음 프레임을 다시 예약하므로 한 번에 하나씩 나아간다. */
function flushFrame(): void {
  const queued = [...pendingFrames]
  pendingFrames.clear()
  for (const [, cb] of queued) cb(0)
}

/** jsdom 은 레이아웃을 계산하지 않는다 — 좌표는 전부 우리가 박아 준다. */
function setRect(el: HTMLElement, box: { x: number; y: number; w: number; h: number }): void {
  el.getBoundingClientRect = () =>
    ({
      x: box.x,
      y: box.y,
      left: box.x,
      top: box.y,
      width: box.w,
      height: box.h,
      right: box.x + box.w,
      bottom: box.y + box.h,
      toJSON: () => ({})
    }) as DOMRect
}

function layouts(): HostedViewLayout[][] {
  return fakeApi.called('views.setLayout').map((call) => call.args[0] as HostedViewLayout[])
}

function Harness(props: { tabId: string | null; enabled?: boolean }): React.ReactElement {
  const { ref } = useHostedView({
    tabId: props.tabId,
    workspaceId: 'ws-1',
    kind: 'dev',
    enabled: props.enabled
  })
  return <div data-testid={`ph-${props.tabId ?? 'none'}`} ref={ref} />
}

beforeEach(() => {
  nextFrameId = 1
  pendingFrames.clear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++
    pendingFrames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pendingFrames.delete(id)
  })
  resetHostedViews()
  resetViewSuppression()
  fakeApi.reset()
})

afterEach(() => {
  resetHostedViews()
  resetViewSuppression()
  vi.unstubAllGlobals()
})

describe('useHostedView', () => {
  it('자리가 그대로면 첫 프레임 뒤로는 IPC 가 나가지 않는다 — 유휴 상태 비용이 0 이어야 한다', () => {
    const { getByTestId } = render(<Harness tabId="tab-1" />)
    setRect(getByTestId('ph-tab-1'), { x: 10, y: 20, w: 300, h: 400 })

    flushFrame()
    expect(layouts()).toHaveLength(1)

    flushFrame()
    flushFrame()
    flushFrame()
    expect(layouts()).toHaveLength(1)
  })

  it('자리가 바뀌면 그 프레임에 바뀐 것만 실어 보낸다', () => {
    const { getByTestId } = render(<Harness tabId="tab-1" />)
    const el = getByTestId('ph-tab-1')
    setRect(el, { x: 10, y: 20, w: 300, h: 400 })
    flushFrame()

    setRect(el, { x: 10, y: 20, w: 500, h: 400 })
    flushFrame()

    const sent = layouts()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual([
      { tabId: 'tab-1', x: 10, y: 20, width: 500, height: 400, visible: true }
    ])
  })

  it('0×0 이면 숨긴다 — 감춘 탭의 자리표시자가 그렇게 보인다', () => {
    const { getByTestId } = render(<Harness tabId="tab-1" />)
    setRect(getByTestId('ph-tab-1'), { x: 0, y: 0, w: 0, h: 0 })

    flushFrame()
    expect(layouts()[0][0].visible).toBe(false)
  })

  it('가림이 걸리면 숨기고, 풀리면 다시 보인다 — 모달이 뷰 아래로 사라지는 것을 막는 경로다', () => {
    const { getByTestId } = render(<Harness tabId="tab-1" />)
    setRect(getByTestId('ph-tab-1'), { x: 0, y: 0, w: 300, h: 300 })
    flushFrame()
    expect(layouts()[0][0].visible).toBe(true)

    const release = suppressAllViews()
    flushFrame()
    expect(layouts()[1][0].visible).toBe(false)

    release()
    flushFrame()
    expect(layouts()[2][0].visible).toBe(true)
  })

  it('호출부가 enabled 를 끄면 자리가 멀쩡해도 숨긴다 — 빈 화면·실패 화면을 그 자리에 그릴 때', () => {
    const { getByTestId, rerender } = render(<Harness tabId="tab-1" enabled />)
    setRect(getByTestId('ph-tab-1'), { x: 0, y: 0, w: 300, h: 300 })
    flushFrame()
    expect(layouts()[0][0].visible).toBe(true)

    rerender(<Harness tabId="tab-1" enabled={false} />)
    flushFrame()
    expect(layouts()[1][0].visible).toBe(false)

    // 끄고 켜는 것으로 뷰를 창에서 떼지는 않는다 — 그러면 깜빡인다.
    expect(fakeApi.called('views.detach')).toHaveLength(0)
  })

  it('언마운트하면 뷰를 떼고 루프를 멈춘다', () => {
    const { getByTestId, unmount } = render(<Harness tabId="tab-1" />)
    setRect(getByTestId('ph-tab-1'), { x: 0, y: 0, w: 300, h: 300 })
    flushFrame()
    expect(layouts()).toHaveLength(1)

    unmount()
    expect(fakeApi.called('views.detach')).toHaveLength(1)

    flushFrame()
    flushFrame()
    expect(layouts()).toHaveLength(1)
  })

  it('탭이 둘이어도 프레임당 IPC 는 한 건이다 — 루프가 하나라는 성질', () => {
    const { getByTestId } = render(
      <>
        <Harness tabId="tab-1" />
        <Harness tabId="tab-2" />
      </>
    )
    setRect(getByTestId('ph-tab-1'), { x: 0, y: 0, w: 300, h: 300 })
    setRect(getByTestId('ph-tab-2'), { x: 0, y: 300, w: 300, h: 300 })

    flushFrame()
    const sent = layouts()
    expect(sent).toHaveLength(1)
    expect(sent[0].map((l) => l.tabId).sort()).toEqual(['tab-1', 'tab-2'])
  })

  it('tabId 가 없으면 아무것도 등록하지 않는다', () => {
    render(<Harness tabId={null} />)
    flushFrame()
    expect(layouts()).toHaveLength(0)
    expect(fakeApi.called('views.ensure')).toHaveLength(0)
  })

  it('gone 이 오면 상태를 비운다 — 화면이 빈 페이지가 아니라 "다시 열기" 를 그려야 한다', () => {
    function StateProbe(): React.ReactElement {
      const { ref, state } = useHostedView({ tabId: 'tab-1', workspaceId: 'ws-1', kind: 'dev' })
      return (
        <div ref={ref} data-testid="probe">
          {state ? state.url : 'no-state'}
        </div>
      )
    }
    const { getByTestId } = render(<StateProbe />)

    act(() =>
      fakeApi.dispatch('views.onEvent', {
        type: 'state',
        tabId: 'tab-1',
        url: 'http://localhost:5173/',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        ready: true
      })
    )
    expect(getByTestId('probe')).toHaveTextContent('http://localhost:5173/')

    act(() => fakeApi.dispatch('views.onEvent', { type: 'gone', tabId: 'tab-1' }))
    expect(getByTestId('probe')).toHaveTextContent('no-state')
  })

  it('다른 탭의 이벤트는 무시한다', () => {
    function StateProbe(): React.ReactElement {
      const { ref, state } = useHostedView({ tabId: 'tab-1', workspaceId: 'ws-1', kind: 'dev' })
      return (
        <div ref={ref} data-testid="probe">
          {state ? state.url : 'no-state'}
        </div>
      )
    }
    const { getByTestId } = render(<StateProbe />)

    act(() =>
      fakeApi.dispatch('views.onEvent', {
        type: 'state',
        tabId: 'tab-2',
        url: 'http://example.com/',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        ready: true
      })
    )
    expect(getByTestId('probe')).toHaveTextContent('no-state')
  })
})
