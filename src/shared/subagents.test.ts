import { describe, expect, it } from 'vitest'
import { mainConversationItems, subagentAddress, subagentChildren, subagentRows } from './subagents'
import type { ChatItem } from './types'

const ts = 1

function assistant(id: string, text: string, parentToolId?: string): ChatItem {
  return { id, type: 'assistant', text, ts, ...(parentToolId ? { parentToolId } : {}) }
}

function row(toolId: string): ChatItem {
  return {
    id: `subagent:${toolId}`,
    type: 'subagent',
    toolId,
    backend: 'claude',
    agentType: 'Explore',
    description: 'look around',
    status: 'running',
    // 주소가 되는 값. task_started 가 실어 주는 SDK task id 다.
    taskId: `task-${toolId}`,
    ts
  }
}

describe('서브에이전트 항목 가르기', () => {
  it('서브에이전트가 없으면 같은 배열을 그대로 돌려준다', () => {
    // 참조가 바뀌면 이걸로 memo 를 거는 하위 계산(도구 묶음·체크리스트·검색 색인)이 전부 다시
    // 돈다. 대부분의 대화에 서브에이전트가 없으므로 이 경로가 기본이다.
    const items = [assistant('a', 'hello'), assistant('b', 'world')]
    expect(mainConversationItems(items)).toBe(items)
  })

  it('부모 대화에서 서브에이전트의 항목과 패널 행을 걷어 낸다', () => {
    const items = [
      assistant('a', 'parent'),
      row('t1'),
      assistant('b', 'child', 't1'),
      assistant('c', 'parent again')
    ]
    expect(mainConversationItems(items).map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('서브에이전트마다 자기 항목만 모은다', () => {
    const items = [
      row('t1'),
      row('t2'),
      assistant('a', 'from one', 't1'),
      assistant('b', 'from two', 't2'),
      assistant('c', 'from one again', 't1')
    ]
    expect(subagentRows(items).map((r) => r.toolId)).toEqual(['t1', 't2'])
    expect(subagentChildren(items, 't1').map((item) => item.id)).toEqual(['a', 'c'])
    expect(subagentChildren(items, 't2').map((item) => item.id)).toEqual(['b'])
  })
})

describe('말을 걸 수 있는가', () => {
  it('도는 중이고 task id 가 있으면 그 id 로 부를 수 있다', () => {
    // 주소는 이름이 아니라 SDK 의 task id 다 — Wooi 세션의 Agent 도구에는 name 파라미터가
    // 아예 없어서(실물 확인) 이름으로 삼으면 이 기능이 영영 열리지 않는다.
    expect(subagentAddress([row('t1')], 't1')).toEqual({
      canSend: true,
      address: 'task-t1'
    })
  })

  it('끝났으면 부를 수 없다', () => {
    const finished = { ...row('t1'), status: 'completed' } as ChatItem
    expect(subagentAddress([finished], 't1')).toEqual({ canSend: false, reason: 'finished' })
  })

  it('task id 가 없으면 부를 주소가 없다', () => {
    // 위임 실행·Codex collab 이 여기 걸린다 — SDK 의 task 가 아니다.
    const noTask = { ...row('t1') } as Record<string, unknown>
    delete noTask.taskId
    expect(subagentAddress([noTask as ChatItem], 't1')).toEqual({
      canSend: false,
      reason: 'unaddressable'
    })
  })

  it('행이 아예 없으면 끝난 것으로 본다', () => {
    expect(subagentAddress([], 't1')).toEqual({ canSend: false, reason: 'finished' })
  })
})
