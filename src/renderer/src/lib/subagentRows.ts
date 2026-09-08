import type { AgentBackendId, ChatItem, RunningAgent } from '@shared/types'
import { subagentRows } from '@shared/subagents'

/** 끝난 실행을 사이드바에 몇 개까지 남길지. 더 오래된 것은 대화의 Task 카드로 들어간다. */
export const RECENT_LIMIT = 5

/**
 * 사이드바의 서브에이전트 목록을 만드는 곳.
 *
 * 컴포넌트에서 떼어 낸 이유는 **⌃A 순환이 같은 순서를 봐야 하기 때문**이다. 목록과 순환이
 * 각자 정렬하면 눌렀을 때 사이드바에서 다음으로 보이는 것이 아니라 엉뚱한 것으로 들어간다.
 */

/** 사이드바 한 줄. 도는 것(휘발성)과 남은 기록(트랜스크립트)을 같은 모양으로 맞춘 것. */
export interface AgentRow {
  key: string
  /** 대화를 열 수 있는 실행이면 그 도구 호출 id. 없으면 행은 보이되 들어갈 수 없다. */
  toolId: string | null
  taskId: string | null
  agentType: string
  description: string
  backend?: AgentBackendId
  running: boolean
  isTask: boolean
  canStop: boolean
  startedAt: number
  durationMs?: number
  totalTokens?: number
  toolUses?: number
  lastToolName?: string
}

/**
 * 두 출처를 한 목록으로 합친다.
 *
 * **트랜스크립트의 `subagent` 행이 척추다** — 그것만 `toolId` 를 갖고 있어 대화로 들어갈 수 있고,
 * 앱을 껐다 켜도 남는다. 거기에 휘발성 목록(`runningAgents`)의 라이브 수치(토큰·도구 수·마지막
 * 도구)를 얹는다. 그 둘은 `toolUseId` 로 짝지어진다.
 *
 * 짝이 없는 휘발성 항목도 버리지 않는다 — 백그라운드 셸처럼 대화가 아예 없는 실행, 그리고 아직
 * 첫 행이 도착하지 않은 창이 여기 해당한다. 들어갈 수는 없지만 "돌고 있다" 는 사실은 남는다.
 */
export function buildRows(
  items: ChatItem[] | undefined,
  live: RunningAgent[] | undefined,
  includeFinished: boolean
): AgentRow[] {
  const liveByTool = new Map<string, RunningAgent>()
  for (const agent of live ?? []) if (agent.toolUseId) liveByTool.set(agent.toolUseId, agent)

  const running: AgentRow[] = []
  const finished: AgentRow[] = []
  const fromTranscript = new Set<string>()
  for (const row of subagentRows(items ?? [])) {
    fromTranscript.add(row.toolId)
    const agent = liveByTool.get(row.toolId)
    const isRunning = row.status === 'running'
    const tokens = agent?.totalTokens ?? row.totalTokens
    const uses = agent?.toolUses ?? row.toolUses
    const merged: AgentRow = {
      key: row.id,
      toolId: row.toolId,
      taskId: agent?.taskId ?? row.taskId ?? null,
      agentType: agent?.agentType ?? row.agentType,
      description: agent?.description ?? row.description,
      backend: row.backend,
      running: isRunning,
      isTask: false,
      canStop: isRunning && !!(agent?.canStop ?? row.taskId),
      startedAt: row.ts,
      ...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
      ...(tokens != null ? { totalTokens: tokens } : {}),
      ...(uses != null ? { toolUses: uses } : {}),
      ...(agent?.lastToolName ? { lastToolName: agent.lastToolName } : {})
    }
    ;(isRunning ? running : finished).push(merged)
  }

  // 짝이 없는 휘발성 항목 — 대화가 없는 실행. 백그라운드 셸처럼 애초에 대화가 없는 것과, 아직
  // 첫 행이 도착하지 않은 창이 여기다. 예전 그대로 "돌고 있다" 만 알린다.
  for (const agent of live ?? []) {
    if (agent.toolUseId && fromTranscript.has(agent.toolUseId)) continue
    running.push({
      key: `live:${agent.taskId}`,
      toolId: null,
      taskId: agent.taskId,
      agentType: agent.agentType,
      description: agent.description,
      ...(agent.backend ? { backend: agent.backend } : {}),
      running: true,
      isTask: typeof agent.taskType === 'string',
      canStop: !!agent.canStop,
      startedAt: agent.startedAt,
      ...(agent.totalTokens != null ? { totalTokens: agent.totalTokens } : {}),
      ...(agent.toolUses != null ? { toolUses: agent.toolUses } : {}),
      ...(agent.lastToolName ? { lastToolName: agent.lastToolName } : {})
    })
  }

  // 오래 돌고 있는 것이 위로 — 멈춘 것이 눈에 먼저 띄어야 한다. 끝난 것은 최근 순이다.
  running.sort((a, b) => a.startedAt - b.startedAt)
  if (!includeFinished) return running
  return [...running, ...finished.reverse().slice(0, RECENT_LIMIT)]
}

/**
 * ⌃A 가 도는 차례 — 사이드바에 보이는 순서 그대로에서, **실제로 들어갈 수 있는 것**만.
 *
 * 대화가 없는 실행(백그라운드 셸 등)은 빼고 도구 호출 id 가 있는 것만 남긴다. 들어가도 빈
 * 화면인 자리를 순환에 끼우면 키를 누르다 아무것도 없는 곳에서 멈추게 된다.
 */
export function subagentCycle(
  items: ChatItem[] | undefined,
  live: RunningAgent[] | undefined
): string[] {
  return buildRows(items, live, true)
    .map((row) => row.toolId)
    .filter((id): id is string => id != null)
}

/**
 * 지금 자리에서 ⌃A 를 눌렀을 때 갈 곳. null 이면 부모 대화로 돌아간다.
 *
 * 마지막을 지나면 부모로 돌아오는 것이 요점이다 — 그래야 한 키로 축 전체를 돌 수 있고,
 * 나가려고 다른 키를 찾지 않아도 된다.
 */
export function nextSubagent(cycle: readonly string[], current: string | null): string | null {
  if (cycle.length === 0) return null
  const at = current ? cycle.indexOf(current) : -1
  return cycle[at + 1] ?? null
}
