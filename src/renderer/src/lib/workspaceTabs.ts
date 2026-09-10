import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store'
import type { WorkspaceTab, WorkspaceTabKind, WorkspaceTabsState } from '@shared/types'
import { isPathUnsaved } from './tabCloseGuard'

/**
 * 이 워크스페이스의 탭 목록을 읽고 조작한다.
 *
 * 목록의 주인은 main 이다([[main/workspaceTabs]]) — 분리한 패널 창과 메인 창이 같은
 * 워크스페이스를 동시에 그리므로, 렌더러마다 목록을 들고 있으면 둘이 갈린다. 그래서 여기서는
 * 방송을 따라가기만 하고, 바꾸는 것은 전부 IPC 로 보낸다. 응답도 함께 반영하는 이유는
 * 왕복 순서가 방송보다 앞설 수도 뒤설 수도 있어서다(`TerminalPane` 이 같은 이유로 같은 모양이다).
 *
 * **워크스페이스당 한 번만 부른다.** 여러 컴포넌트가 각자 부르면 구독이 그만큼 생기고, 탭이
 * 바뀔 때마다 같은 일이 여러 번 일어난다. 지금은 `App` 이 한 번 부르고 필요한 곳에 내려 준다.
 *
 * 스토어에 두지 않은 이유도 같은 계열이다 — 셀렉터에서 배열을 가공하면 매번 새 참조가 나와
 * 앱이 통째로 죽는다(`lib/selectorStability.test.ts` 가 그걸 막는다). 탭은 로컬 상태로 둔다.
 */
export interface WorkspaceTabsApi {
  tabs: WorkspaceTab[]
  activeId: string
  /** 지금 보고 있는 탭. 목록이 아직 안 왔으면 undefined. */
  active: WorkspaceTab | undefined
  select(tabId: string): void
  close(tabId: string): void
  open(spec: { kind: WorkspaceTabKind; target?: string; title?: string; activate?: boolean }): void
  /** 가장 최근에 닫은 탭을 되살린다(⇧⌘T). 닫은 탭이 없으면 main 이 조용히 무시한다. */
  reopen(): void
}

const EMPTY: WorkspaceTab[] = []

export function useWorkspaceTabs(workspaceId: string): WorkspaceTabsApi {
  const [state, setState] = useState<WorkspaceTabsState | null>(null)

  useEffect(() => {
    if (!workspaceId) return setState(null)
    let alive = true
    const apply = (next: WorkspaceTabsState): void => {
      if (alive && next.workspaceId === workspaceId) setState(next)
    }
    void window.api.tabs.get(workspaceId).then(apply)
    const off = window.api.tabs.onTabs(apply)
    return () => {
      alive = false
      off()
    }
  }, [workspaceId])

  const select = useCallback(
    (tabId: string) => {
      if (workspaceId) void window.api.tabs.select(workspaceId, tabId).then(setState)
    },
    [workspaceId]
  )

  const close = useCallback(
    (tabId: string) => {
      if (!workspaceId) return
      const doClose = (): void => {
        void window.api.tabs.close(workspaceId, tabId).then(setState)
      }
      // 저장하지 않은 편집을 말없이 버리지 않는다([[lib/tabCloseGuard]]). 이 탭이 어느 파일을
      // 가리키는지는 여기가 알고, 그 파일이 더러운지는 편집기가 안다 — 그래서 대조를 여기서 한다.
      const target = state?.tabs.find((t) => t.id === tabId)?.target
      if (!target || !isPathUnsaved(target)) return doClose()
      void useStore
        .getState()
        .confirm({
          title: `Discard unsaved changes to ${target}?`,
          body: 'Your edits were never written to disk. Closing the tab throws them away.',
          confirmLabel: 'Discard',
          danger: true
        })
        .then((ok) => {
          if (ok) doClose()
        })
    },
    [workspaceId, state]
  )

  const open = useCallback(
    (spec: { kind: WorkspaceTabKind; target?: string; title?: string; activate?: boolean }) => {
      if (workspaceId) void window.api.tabs.open(workspaceId, spec).then(setState)
    },
    [workspaceId]
  )

  const reopen = useCallback(() => {
    if (workspaceId) void window.api.tabs.reopen(workspaceId).then(setState)
  }, [workspaceId])

  const tabs = state?.tabs ?? EMPTY
  const activeId = state?.activeId ?? 'work'
  return {
    tabs,
    activeId,
    active: tabs.find((t) => t.id === activeId),
    select,
    close,
    open,
    reopen
  }
}
