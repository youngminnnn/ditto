import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import SubagentsPanel from './SubagentsPanel'
import { renderWithStore, resetStore, useStore } from '../test/harness'
import type { ChatItem } from '@shared/types'

beforeEach(() => resetStore())

/**
 * 이 패널이 지키는 계약은 "무엇을 그리는가" 보다 **언제 펼쳐져 있는가** 다.
 *
 * 도는 중인 것은 펼쳐 두고 끝난 것은 접는다 — 그래야 병렬로 셋을 띄워도 지금 봐야 할 것만
 * 눈에 남는다. 그리고 사용자가 손으로 접거나 편 뒤에는 그 선택이 이긴다: 진행 갱신이 1초에
 * 한 번씩 오는데 그때마다 다시 열리면 접기 버튼이 아무 의미가 없다.
 */

const WS = 'ws1'

function row(over: Partial<Extract<ChatItem, { type: 'subagent' }>> = {}): ChatItem {
  return {
    id: `subagent:${over.toolId ?? 't1'}`,
    type: 'subagent',
    toolId: 't1',
    backend: 'claude',
    agentType: 'Explore',
    description: 'Find the config loader',
    status: 'running',
    ts: Date.now(),
    ...over
  }
}

function seed(items: ChatItem[]): void {
  useStore.setState({ transcripts: { [WS]: items } })
}

describe('Agents 패널', () => {
  it('서브에이전트가 없으면 왜 비어 있는지 설명한다', () => {
    seed([])
    renderWithStore(<SubagentsPanel workspaceId={WS} />)
    expect(screen.getByText('No subagents yet')).toBeInTheDocument()
  })

  it('도는 중인 것은 펼쳐 두고 끝난 것은 접는다', () => {
    seed([
      row({ toolId: 't1' }),
      row({ toolId: 't2', status: 'completed' }),
      {
        id: 'a1',
        type: 'assistant',
        text: 'running agent said this',
        ts: Date.now(),
        parentToolId: 't1'
      },
      {
        id: 'a2',
        type: 'assistant',
        text: 'finished agent said this',
        ts: Date.now(),
        parentToolId: 't2'
      }
    ])
    renderWithStore(<SubagentsPanel workspaceId={WS} />)

    expect(screen.getByText('running agent said this')).toBeInTheDocument()
    expect(screen.queryByText('finished agent said this')).not.toBeInTheDocument()
  })

  it('손으로 접은 뒤에는 그 선택이 기본 규칙을 이긴다', () => {
    seed([
      row({ toolId: 't1' }),
      { id: 'a1', type: 'assistant', text: 'live output', ts: Date.now(), parentToolId: 't1' }
    ])
    renderWithStore(<SubagentsPanel workspaceId={WS} />)

    const toggle = screen.getByRole('button', { expanded: true })
    fireEvent.click(toggle)
    expect(screen.queryByText('live output')).not.toBeInTheDocument()

    // 진행 갱신이 한 번 더 와도 다시 열리지 않는다(같은 id 의 upsert).
    seed([
      row({ toolId: 't1', toolUses: 4 }),
      { id: 'a1', type: 'assistant', text: 'live output', ts: Date.now(), parentToolId: 't1' }
    ])
    expect(screen.queryByText('live output')).not.toBeInTheDocument()
  })

  it('다른 서브에이전트의 항목은 섞이지 않는다', () => {
    seed([
      row({ toolId: 't1' }),
      row({ toolId: 't2' }),
      { id: 'a1', type: 'assistant', text: 'from one', ts: Date.now(), parentToolId: 't1' },
      { id: 'a2', type: 'assistant', text: 'from two', ts: Date.now(), parentToolId: 't2' }
    ])
    const { container } = renderWithStore(<SubagentsPanel workspaceId={WS} />)

    const sections = container.querySelectorAll('[aria-expanded]')
    expect(sections).toHaveLength(2)
    // 각 카드는 자기 자식만 담는다 — 이걸 놓치면 패널이 메인 대화와 같은 뒤엉킴을 되풀이한다.
    const cards = container.querySelectorAll('.rounded-md.border')
    expect(cards[0].textContent).toContain('from one')
    expect(cards[0].textContent).not.toContain('from two')
  })

  it('도는 중인 실행만 중지할 수 있다', () => {
    seed([row({ toolId: 't1', taskId: 'task-1' }), row({ toolId: 't2', status: 'completed' })])
    renderWithStore(<SubagentsPanel workspaceId={WS} />)
    expect(screen.getAllByRole('button', { name: /^Stop subagent/ })).toHaveLength(1)
  })

  it('Codex 는 내부 대화를 주지 않는다는 사실을 그대로 적는다', () => {
    seed([row({ toolId: 't1', backend: 'codex', status: 'completed' })])
    renderWithStore(<SubagentsPanel workspaceId={WS} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/Codex does not stream/)).toBeInTheDocument()
  })
})
