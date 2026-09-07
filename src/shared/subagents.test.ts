import { describe, expect, it } from 'vitest'
import { mainConversationItems, subagentChildren, subagentRows } from './subagents'
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
