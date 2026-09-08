import { describe, expect, it } from 'vitest'
import { buildRows, nextSubagent, subagentCycle } from './subagentRows'
import type { ChatItem, RunningAgent } from '@shared/types'

const ts = 1000

function row(toolId: string, over: Record<string, unknown> = {}): ChatItem {
  return {
    id: `subagent:${toolId}`,
    type: 'subagent',
    toolId,
    taskId: `task-${toolId}`,
    backend: 'claude',
    agentType: 'Explore',
    description: `job ${toolId}`,
    status: 'running',
    ts,
    ...over
  } as ChatItem
}

describe('사이드바 목록', () => {
  it('도는 것이 위(오래된 순), 끝난 것은 아래(최근 순)', () => {
    // 오래 돌고 있는 것이 눈에 먼저 띄어야 하고, 끝난 것은 방금 끝난 것을 가장 자주 다시 본다.
    const items = [
      row('a', { ts: 30 }),
      row('b', { ts: 10 }),
      row('c', { status: 'completed', ts: 20 }),
      row('d', { status: 'completed', ts: 40 })
    ]
    expect(buildRows(items, [], true).map((r) => r.toolId)).toEqual(['b', 'a', 'd', 'c'])
  })

  it('다른 워크스페이스 행에는 끝난 것을 붙이지 않는다', () => {
    // 사이드바는 "지금 무슨 일이 도는가" 를 보는 곳이다 — 워크스페이스마다 이력이 꼬리처럼
    // 쌓이면 그 성격이 사라진다.
    const items = [row('a'), row('b', { status: 'completed' })]
    expect(buildRows(items, [], false).map((r) => r.toolId)).toEqual(['a'])
  })

  it('끝난 것은 최근 다섯 개까지만 남긴다', () => {
    const items = Array.from({ length: 9 }, (_, i) => row(`f${i}`, { status: 'completed', ts: i }))
    expect(buildRows(items, [], true)).toHaveLength(5)
  })

  it('라이브 수치가 기록을 이긴다', () => {
    // 트랜스크립트 행은 시작·종료에서만 적히므로 도는 동안의 최신값은 휘발성 쪽에 있다.
    const live: RunningAgent[] = [
      {
        taskId: 'task-a',
        toolUseId: 'a',
        agentType: 'Explore',
        description: 'now reading',
        startedAt: ts,
        toolUses: 7,
        lastToolName: 'Read'
      }
    ]
    const [merged] = buildRows([row('a', { toolUses: 1 })], live, true)
    expect(merged).toMatchObject({ toolUses: 7, lastToolName: 'Read', description: 'now reading' })
  })

  it('대화가 없는 실행도 목록에는 남되 들어갈 수는 없다', () => {
    // 백그라운드 셸처럼 애초에 대화가 없는 것. 사라지면 "돌고 있다" 는 사실까지 잃는다.
    const live: RunningAgent[] = [
      {
        taskId: 'shell-1',
        taskType: 'local_bash',
        agentType: 'bash',
        description: 'npm test',
        startedAt: ts
      }
    ]
    const rows = buildRows([], live, true)
    expect(rows).toHaveLength(1)
    expect(rows[0].toolId).toBeNull()
  })
})

describe('⌃A 순환', () => {
  it('들어갈 수 있는 것만, 사이드바 순서 그대로 돈다', () => {
    const live: RunningAgent[] = [
      {
        taskId: 'shell-1',
        taskType: 'local_bash',
        agentType: 'bash',
        description: 'npm test',
        startedAt: ts
      }
    ]
    const items = [row('a', { ts: 20 }), row('b', { ts: 10 })]
    // 셸은 대화가 없으므로 순환에서 빠진다 — 들어가도 빈 화면인 자리에서 멈추면 안 된다.
    expect(subagentCycle(items, live)).toEqual(['b', 'a'])
  })

  it('부모에서 누르면 첫 번째로 간다', () => {
    expect(nextSubagent(['a', 'b'], null)).toBe('a')
  })

  it('다음으로 넘어간다', () => {
    expect(nextSubagent(['a', 'b'], 'a')).toBe('b')
  })

  it('마지막을 지나면 부모로 돌아온다', () => {
    // 한 키로 축 전체를 돌 수 있어야 한다 — 나가려고 다른 키를 찾게 만들지 않는다.
    expect(nextSubagent(['a', 'b'], 'b')).toBeNull()
  })

  it('갈 곳이 없으면 null', () => {
    expect(nextSubagent([], null)).toBeNull()
  })

  it('목록에 없는 곳에 있으면 처음부터 돈다', () => {
    // 보던 서브에이전트가 목록에서 밀려난 경우(끝난 것 상한). 갇히지 않고 다시 첫 번째로 간다.
    expect(nextSubagent(['a', 'b'], 'gone')).toBe('a')
  })
})
