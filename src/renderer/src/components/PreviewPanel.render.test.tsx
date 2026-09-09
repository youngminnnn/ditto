import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PreviewPanel from './PreviewPanel'
import { workspace } from '../test/fixtures'
import { fakeApi } from '../test/fakeApi'
import { resetStore } from '../test/harness'
import { resetHostedViews } from '../lib/hostedView'
import { resetViewSuppression } from '../lib/viewSuppress'

/**
 * PreviewPanel 은 최근까지 `<webview>` 를 그렸다 — jsdom 에 그 엘리먼트가 없어 렌더 자체가
 * 불가능했고, 그래서 이 컴포넌트에는 테스트가 하나도 없었다. main 이 소유한 뷰 + 자리표시자
 * `<div>` 구조([[lib/hostedView]])로 바뀌면서 순수 DOM + IPC mock 으로 테스트할 수 있게 됐다 —
 * 이 파일이 그 첫 회귀 안전망이다.
 *
 * `useHostedView` 자체의 계약(프레임 루프·layout 측정)은 `lib/hostedView.test.tsx` 가 이미
 * 지키고 있으므로 여기서는 그 위에서 PreviewPanel 이 무엇을 그리고 무엇을 부르는지만 본다.
 */

// hostedView 의 프레임 루프가 실제 rAF 를 타면 테스트 사이로 새어 나간다. 여기서는 레이아웃
// 측정 자체가 관심사가 아니라 굴리지도 않지만, hostedView.test.tsx 와 같은 방식으로 스텁을
// 깔아 둔다 — 안 그러면 매 렌더마다 진짜 rAF 가 잡혀 다음 테스트로 넘어간다.
let nextFrameId = 1
const pendingFrames = new Map<number, FrameRequestCallback>()

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
  resetStore()
  resetHostedViews()
  resetViewSuppression()
})

afterEach(() => {
  resetHostedViews()
  resetViewSuppression()
  vi.unstubAllGlobals()
})

/** fixture 의 workspace id 로 고정한 tabId. devTabId() 와 같은 규칙(`dev:<workspaceId>`)이다. */
const TAB_ID = 'dev:workspace-1'

function addressInput(): HTMLInputElement {
  return screen.getByLabelText('Preview address') as HTMLInputElement
}

/**
 * 뷰가 준비될 때까지 기다린다.
 *
 * `useHostedView` 는 마운트 직후 `views.ensure().then(views.attach).then(setAttached(true))`
 * 를 두 단계 프라미스로 밟는다 — `navigate()`·새로고침 버튼 등은 `attached` 가 참이어야
 * 명령을 보낸다. 렌더가 끝난 시점에는 아직 그 프라미스가 안 풀려 있으므로, 이걸 거치지 않고
 * 바로 상호작용하면 아무 IPC 도 나가지 않은 채 조용히 실패한다.
 */
async function waitReady(): Promise<void> {
  await act(async () => {})
}

describe('PreviewPanel', () => {
  it('주소창이 뷰의 실제 위치를 따라간다', () => {
    render(<PreviewPanel workspace={workspace()} navTarget={null} active />)

    act(() => {
      fakeApi.dispatch('views.onEvent', {
        type: 'state',
        tabId: TAB_ID,
        url: 'http://localhost:5173/x',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        ready: true
      })
    })

    expect(addressInput().value).toBe('http://localhost:5173/x')
  })

  it('주소를 제출하면 그 탭으로 load 한다 — 포트만 쳐도 normalizeInputUrl 이 채운다', async () => {
    render(<PreviewPanel workspace={workspace()} navTarget={null} active />)
    await waitReady()

    fireEvent.change(addressInput(), { target: { value: '3000' } })
    fireEvent.submit(addressInput().closest('form')!)

    expect(fakeApi.called('views.load').at(-1)?.args).toEqual([TAB_ID, 'http://localhost:3000'])
  })

  it('앞/뒤/새로고침 버튼이 그 탭의 명령을 부른다', async () => {
    render(<PreviewPanel workspace={workspace()} navTarget={null} active />)
    await waitReady()

    // canGoBack 이 거짓인 동안은 Back 이 눌리지 않는다.
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()

    act(() => {
      fakeApi.dispatch('views.onEvent', {
        type: 'state',
        tabId: TAB_ID,
        url: 'http://localhost:5173/',
        loading: false,
        canGoBack: true,
        canGoForward: true,
        ready: true
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(fakeApi.called('views.goBack').at(-1)?.args).toEqual([TAB_ID])

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(fakeApi.called('views.goForward').at(-1)?.args).toEqual([TAB_ID])

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(fakeApi.called('views.reload').at(-1)?.args).toEqual([TAB_ID])
  })

  it('로딩 중에는 새로고침이 정지로 바뀐다', async () => {
    render(<PreviewPanel workspace={workspace()} navTarget={null} active />)
    await waitReady()

    act(() => {
      fakeApi.dispatch('views.onEvent', {
        type: 'state',
        tabId: TAB_ID,
        url: 'http://localhost:5173/',
        loading: true,
        canGoBack: false,
        canGoForward: false,
        ready: true
      })
    })

    // 로딩 중에는 같은 자리의 버튼이 "Reload" 가 아니라 "Stop" 으로 나온다.
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(fakeApi.called('views.stop').at(-1)?.args).toEqual([TAB_ID])
  })

  it('실패하면 안내가 뜨고 다시 시도가 reload 를 부른다', () => {
    render(<PreviewPanel workspace={workspace()} navTarget={null} active />)

    act(() => {
      fakeApi.dispatch('views.onEvent', {
        type: 'fail',
        tabId: TAB_ID,
        errorCode: -105,
        errorDescription: 'NAME_NOT_RESOLVED',
        isMainFrame: true
      })
    })

    expect(screen.getByText('Could not load that page.')).toBeInTheDocument()
    expect(screen.getByText('NAME_NOT_RESOLVED')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Try again'))
    expect(fakeApi.called('views.reload').at(-1)?.args).toEqual([TAB_ID])
  })

  it('서브리소스 실패는 화면을 덮지 않는다 — 이미지 404 하나로 전체를 에러로 덮던 회귀를 막는다', () => {
    render(<PreviewPanel workspace={workspace()} navTarget={null} active />)

    act(() => {
      fakeApi.dispatch('views.onEvent', {
        type: 'fail',
        tabId: TAB_ID,
        errorCode: -105,
        errorDescription: 'NAME_NOT_RESOLVED',
        isMainFrame: false
      })
    })

    expect(screen.queryByText('Could not load that page.')).not.toBeInTheDocument()
  })

  it('다른 탭의 이벤트는 무시한다', () => {
    render(<PreviewPanel workspace={workspace()} navTarget={null} active />)

    act(() => {
      fakeApi.dispatch('views.onEvent', {
        type: 'state',
        tabId: 'dev:other-workspace',
        url: 'http://example.com/',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        ready: true
      })
    })

    expect(addressInput().value).toBe('')
  })

  it('콘솔 에러 배지 — 개수가 뜨고 누르면 목록을 당겨 온다', () => {
    const ws = workspace()
    render(<PreviewPanel workspace={ws} navTarget={null} active />)

    act(() => {
      fakeApi.dispatch('preview.onIssues', {
        tabId: TAB_ID,
        workspaceId: ws.id,
        errors: 2,
        warnings: 1
      })
    })

    const badge = screen.getByTitle('Console and network errors from this page')
    expect(badge).toHaveTextContent('2')
    expect(badge).toHaveTextContent('1')

    fireEvent.click(badge)
    expect(fakeApi.called('preview.listIssues').at(-1)?.args).toEqual([TAB_ID])
  })

  it('다른 탭의 이슈 방송은 무시한다 — 같은 워크스페이스라도 탭이 다르면 이 배지를 건드리지 않는다', () => {
    const ws = workspace()
    render(<PreviewPanel workspace={ws} navTarget={null} active />)

    act(() => {
      fakeApi.dispatch('preview.onIssues', {
        tabId: 'dev:other-tab',
        workspaceId: ws.id,
        errors: 5,
        warnings: 5
      })
    })

    expect(screen.queryByTitle('Console and network errors from this page')).not.toBeInTheDocument()
  })
})
