import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatItem } from '@shared/types'
import { AsyncQueue } from './asyncQueue'
import { testWooiMcp as wooiMcp } from './testWooiMcp'

/**
 * 서브에이전트의 대화가 부모 대화와 갈라져 나오는지를 본다.
 *
 * 여기서 지키려는 계약은 세 가지다.
 *  1. `parent_tool_use_id` 가 실린 산출물은 전부 `parentToolId` 를 달고 나온다 — 이 표시가
 *     없으면 Agents 패널은 그 항목이 누구 것인지 알 방법이 없고, 부모 대화는 그것을 걸러 낼
 *     방법이 없다.
 *  2. **부모와 서브에이전트의 스트림이 뒤섞여 도착해도 델타가 서로에게 새지 않는다.** 이것이
 *     회귀 방지의 핵심이다 — 예전처럼 "지금 쌓는 메시지 id" 를 한 칸으로 들고 있으면 나중에
 *     온 message_start 가 앞의 것을 덮어써, 부모가 하던 말이 서브에이전트 버블로 들어간다.
 *  3. task_* 수명주기가 패널의 행을 running → 종료로 옮기고, 종료만 디스크에 남는다.
 */

class FakeQuery {
  readonly out = new AsyncQueue<Record<string, unknown>>()
  readonly stopTask = vi.fn(async (_taskId: string) => {})
  async getContextUsage(): Promise<Record<string, number>> {
    return { totalTokens: 0, maxTokens: 200_000, percentage: 0, autoCompactThreshold: 167_000 }
  }
  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
    return this.out[Symbol.asyncIterator]()
  }
}

let query: FakeQuery

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    query = new FakeQuery()
    return query
  }
}))
vi.mock('./executable', () => ({ resolveClaudeExecutable: () => null }))

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

async function start(): Promise<{ events: ChatEvent[]; persisted: ChatItem[] }> {
  const { ClaudeSession } = await import('./session')
  const events: ChatEvent[] = []
  const persisted: ChatItem[] = []
  const session = new ClaudeSession({
    cwd: process.cwd(),
    repoPath: null,
    mcpSettings: { servers: [], disabledInherited: [] },
    model: null,
    effort: null,
    fastMode: false,
    permissionMode: 'default',
    autoCompact: false,
    peer: { name: 'wooi/repo/test', inbound: 'refuse' },
    resumeSessionId: null,
    additionalDirs: [],
    wooiMcp,
    emit: (event) => events.push(event),
    persist: (item) => persisted.push(item),
    requestPermission: async () => ({ behavior: 'deny' as const }),
    onSessionId: () => {},
    onPermissionMode: () => {},
    settleIdle: () => {}
  })
  session.send('start')
  await tick()
  return { events, persisted }
}

function system(subtype: string, fields: Record<string, unknown>): Record<string, unknown> {
  return { type: 'system', subtype, uuid: `${subtype}-uuid`, session_id: 'session', ...fields }
}

/** assistant 메시지 한 통. parent 를 주면 서브에이전트가 낸 것이 된다. */
function assistant(
  id: string,
  content: unknown[],
  parent: string | null = null
): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: `u-${id}`,
    session_id: 'session',
    parent_tool_use_id: parent,
    message: { id, role: 'assistant', model: 'claude-opus-5', content }
  }
}

function items(events: ChatEvent[]): ChatItem[] {
  return events.flatMap((event) => (event.type === 'item' ? [event.item] : []))
}

function deltas(events: ChatEvent[]): Extract<ChatEvent, { type: 'delta' }>[] {
  return events.filter(
    (event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta'
  )
}

function subagentRow(source: { type: string }[]): Extract<ChatItem, { type: 'subagent' }>[] {
  return source.filter(
    (item): item is Extract<ChatItem, { type: 'subagent' }> => item.type === 'subagent'
  )
}

describe('ClaudeSession 서브에이전트 대화', () => {
  beforeEach(() => vi.clearAllMocks())

  it('서브에이전트가 낸 말·도구 호출·결과에 부모 표시를 단다', async () => {
    const { events } = await start()

    query.out.push(assistant('m1', [{ type: 'text', text: 'Reading the config' }], 'toolu_parent'))
    query.out.push(
      assistant(
        'm2',
        [{ type: 'tool_use', id: 'toolu_child', name: 'Read', input: { file_path: '/a.ts' } }],
        'toolu_parent'
      )
    )
    query.out.push({
      type: 'user',
      uuid: 'u-r',
      session_id: 'session',
      parent_tool_use_id: 'toolu_parent',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_child', content: 'ok' }]
      }
    })
    await tick()

    // 첫 사용자 메시지(session.send)는 이 검사의 대상이 아니다.
    const produced = items(events).filter((item) => item.type !== 'user')
    expect(
      produced.map((item) => [item.type, (item as { parentToolId?: string }).parentToolId])
    ).toEqual([
      ['assistant', 'toolu_parent'],
      ['tool_use', 'toolu_parent'],
      ['tool_result', 'toolu_parent']
    ])
  })

  it('부모의 산출물에는 표시를 달지 않는다', async () => {
    const { events } = await start()
    query.out.push(assistant('m1', [{ type: 'text', text: 'On it' }]))
    await tick()

    const [item] = items(events).filter((i) => i.type === 'assistant')
    expect(item).toBeDefined()
    expect('parentToolId' in item! && item.parentToolId).toBeFalsy()
  })

  it('부모와 서브에이전트의 스트림이 뒤섞여도 델타가 서로에게 새지 않는다', async () => {
    const { events } = await start()

    // 부모가 말을 시작하고, 그 사이에 서브에이전트가 자기 메시지를 시작한다. 한 칸짜리
    // "지금 쌓는 id" 로는 여기서 부모의 자리가 덮여, 이어지는 부모 델타가 남의 버블로 간다.
    query.out.push({
      type: 'stream_event',
      uuid: 's1',
      session_id: 'session',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id: 'parent-msg' } }
    })
    query.out.push({
      type: 'stream_event',
      uuid: 's2',
      session_id: 'session',
      parent_tool_use_id: 'toolu_parent',
      event: { type: 'message_start', message: { id: 'child-msg' } }
    })
    query.out.push({
      type: 'stream_event',
      uuid: 's3',
      session_id: 'session',
      parent_tool_use_id: 'toolu_parent',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'child says' } }
    })
    query.out.push({
      type: 'stream_event',
      uuid: 's4',
      session_id: 'session',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'parent says' } }
    })
    await tick()

    expect(deltas(events).map((d) => [d.id, d.text, d.parentToolId])).toEqual([
      ['child-msg:text', 'child says', 'toolu_parent'],
      ['parent-msg:text', 'parent says', undefined]
    ])
  })

  it('서브에이전트의 모델은 세션 모델로 보고하지 않는다', async () => {
    const { events } = await start()
    query.out.push({
      type: 'system',
      subtype: 'init',
      uuid: 'init',
      session_id: 'session',
      tools: [],
      mcp_servers: [],
      model: 'claude-opus-5',
      permissionMode: 'default',
      slash_commands: [],
      apiKeySource: 'none',
      cwd: process.cwd()
    })
    await tick()
    const before = events.filter((e) => e.type === 'session').length

    // 서브에이전트를 sonnet 으로 띄운 경우. 이 메시지의 모델을 세션 모델로 올리면 워크스페이스
    // 표시가 서브에이전트를 따라 흔들린다.
    query.out.push({
      type: 'assistant',
      uuid: 'u-sub',
      session_id: 'session',
      parent_tool_use_id: 'toolu_parent',
      message: {
        id: 'm-sub',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'done' }]
      }
    })
    await tick()

    expect(events.filter((e) => e.type === 'session').length).toBe(before)
  })

  it('task 수명주기가 패널의 행을 running 에서 종료로 옮기고, 종료만 디스크에 남긴다', async () => {
    const { events, persisted } = await start()

    query.out.push(
      system('task_started', {
        task_id: 'task-1',
        tool_use_id: 'toolu_parent',
        subagent_type: 'Explore',
        description: 'Find the config loader'
      })
    )
    await tick()
    expect(subagentRow(items(events)).at(-1)).toMatchObject({
      id: 'subagent:toolu_parent',
      toolId: 'toolu_parent',
      backend: 'claude',
      agentType: 'Explore',
      status: 'running'
    })
    expect(subagentRow(persisted)).toHaveLength(1)

    // 진행 갱신은 화면만 바꾼다 — 서브에이전트 하나가 JSONL 에 수백 줄을 남기면 안 된다.
    query.out.push(
      system('task_progress', {
        task_id: 'task-1',
        description: 'Reading files',
        usage: { total_tokens: 1200, tool_uses: 3, duration_ms: 900 }
      })
    )
    await tick()
    expect(subagentRow(items(events)).at(-1)).toMatchObject({ status: 'running', toolUses: 3 })
    expect(subagentRow(persisted)).toHaveLength(1)

    query.out.push(
      system('task_notification', {
        task_id: 'task-1',
        status: 'completed',
        output_file: '/tmp/out',
        summary: 'found it',
        usage: { total_tokens: 2000, tool_uses: 5, duration_ms: 4000 }
      })
    )
    await tick()
    expect(subagentRow(persisted).at(-1)).toMatchObject({
      status: 'completed',
      toolUses: 5,
      totalTokens: 2000
    })
    expect(subagentRow(persisted)).toHaveLength(2)
  })

  it('tool_use_id 가 없으면 행을 만들지 않는다', async () => {
    const { events, persisted } = await start()
    query.out.push(
      system('task_started', { task_id: 'task-2', subagent_type: 'Explore', description: 'x' })
    )
    await tick()

    // 자식 항목을 묶을 열쇠가 없으면 펼쳐도 비어 있는 껍데기 행이 된다. 사이드바의 실행 중
    // 목록에는 그대로 올라가므로 "돌고 있다" 는 사실 자체는 잃지 않는다.
    expect(subagentRow(items(events))).toHaveLength(0)
    expect(subagentRow(persisted)).toHaveLength(0)
    const agents = [...events].reverse().find((e) => e.type === 'agents')
    expect(agents?.agents.map((a) => a.taskId)).toEqual(['task-2'])
  })
})
