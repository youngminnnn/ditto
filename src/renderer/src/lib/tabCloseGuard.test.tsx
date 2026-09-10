import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { fakeApi } from '../test/fakeApi'
import { useStore } from '../store'
import { useWorkspaceTabs } from './workspaceTabs'
import { isPathUnsaved, registerUnsavedPaths, resetUnsavedPaths } from './tabCloseGuard'

/**
 * 이 코드가 막는 것은 **말없이 사라지는 편집**이다. 탭은 스트립의 × 와 `⌘W` 로 닫히는데 둘 다
 * 파일 탭 바깥이라, 가드가 빠지면 저장하지 않은 내용이 아무 말 없이 없어진다.
 *
 * 그래서 여기서 지키는 것은 두 가지다: 더러운 경로를 알아본다는 것, 그리고 **더러우면 닫지
 * 않는다**는 것. 두 번째가 본체다.
 */

beforeEach(() => {
  resetUnsavedPaths()
  fakeApi.reset()
})
afterEach(() => resetUnsavedPaths())

describe('저장하지 않은 경로 레지스트리', () => {
  it('등록이 없으면 아무 경로도 더럽지 않다', () => {
    expect(isPathUnsaved('src/a.ts')).toBe(false)
  })

  it('등록한 목록에 있으면 더럽다고 답한다', () => {
    registerUnsavedPaths(() => ['src/a.ts'])
    expect(isPathUnsaved('src/a.ts')).toBe(true)
    expect(isPathUnsaved('src/b.ts')).toBe(false)
  })

  it('해제하면 다시 깨끗해진다 — 언마운트한 화면이 계속 닫기를 막으면 안 된다', () => {
    const off = registerUnsavedPaths(() => ['src/a.ts'])
    off()
    expect(isPathUnsaved('src/a.ts')).toBe(false)
  })

  it('목록은 부를 때마다 새로 읽는다 — 저장하면 그 즉시 깨끗해져야 한다', () => {
    let dirty = ['src/a.ts']
    registerUnsavedPaths(() => dirty)
    expect(isPathUnsaved('src/a.ts')).toBe(true)
    dirty = []
    expect(isPathUnsaved('src/a.ts')).toBe(false)
  })
})

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useWorkspaceTabs>) => void }) {
  const api = useWorkspaceTabs('ws-1')
  onReady(api)
  return null
}

describe('탭 닫기', () => {
  const tabs = {
    workspaceId: 'ws-1',
    tabs: [
      { id: 'work', kind: 'work' as const },
      { id: 'tab-file', kind: 'file' as const, target: 'src/a.ts' }
    ],
    activeId: 'work'
  }

  it('더러운 파일을 가리키는 탭은 묻기 전에 닫지 않는다', async () => {
    fakeApi.override('tabs.get', () => tabs)
    registerUnsavedPaths(() => ['src/a.ts'])

    let api!: ReturnType<typeof useWorkspaceTabs>
    render(<Harness onReady={(a) => (api = a)} />)
    // 목록이 도착해야 탭의 경로를 대조할 수 있다.
    await act(async () => {})

    act(() => api.close('tab-file'))
    await act(async () => {})

    // 아직 닫히지 않았고, 대신 확인 대화상자가 떠 있다.
    expect(fakeApi.called('tabs.close')).toHaveLength(0)
    expect(useStore.getState().confirmState).not.toBeNull()

    // 사용자가 물러나면 탭은 그대로 남는다.
    act(() => useStore.getState().resolveConfirm(false))
    await act(async () => {})
    expect(fakeApi.called('tabs.close')).toHaveLength(0)
  })

  it('깨끗한 탭은 묻지 않고 곧장 닫는다 — 매번 묻는 확인은 곧 무시된다', async () => {
    fakeApi.override('tabs.get', () => tabs)

    let api!: ReturnType<typeof useWorkspaceTabs>
    render(<Harness onReady={(a) => (api = a)} />)
    await act(async () => {})

    act(() => api.close('tab-file'))
    await act(async () => {})

    expect(fakeApi.called('tabs.close')).toHaveLength(1)
    expect(useStore.getState().confirmState).toBeNull()
  })
})
