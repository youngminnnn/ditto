import { randomUUID } from 'node:crypto'
import {
  AGENT_BACKEND_LABELS,
  type AgentBackendId,
  type ChatItem,
  type RunningAgent,
  type Workspace
} from '@shared/types'
import { getStore } from '../../store'
import { log } from '../../logger'
import { runSubAgent } from '../../subagent/run'
import { recordDelegatedUsage } from '../../usageLedger'
import { agentDefaultsFor, delegateBackendsFor } from '../multiAgent'
import { validateAgentRunOptions } from './agentOptions'
import { askSubAgentPermission } from './permission'
import type { AgentToolDeps } from './registry'

/**
 * 위임 서브에이전트 도구의 실행부 — 다른 종류의 에이전트를 서브에이전트로 띄우고 결과를 기다린다.
 *
 * 다른 Wooi 도구와 같은 자리에서 돈다([[agent/tools/registry]]). 전송 계층(Claude 의 인프로세스
 * MCP 서버 · Codex 의 stdio shim)은 이름과 인자만 나르고, 실행은 메인이 하나로 소유한다.
 *
 * 메인에서 도는 것이 오히려 유리하다: 사이드바 갱신도 중단도 메인이 소유한 것들이라, 호스트를
 * 거치지 않고 직접 다룰 수 있다.
 *
 * ## 오래 걸리는 도구
 *
 * 이 도구는 분 단위로 블로킹한다. 소켓 계약은 이를 허용한다 — 타임아웃이 없고, 이미 사용자
 * 승인 카드를 기다리며 같은 시간만큼 붙잡는다([[agent/tools/socket]]).
 */

/** 진행 중인 위임 실행. 워크스페이스가 중단·정리될 때 함께 끊는다. */
const running = new Map<string, { workspaceId: string; abort: AbortController }>()

/** 워크스페이스별 실행 중 목록. 사이드바가 보는 `agents` 이벤트의 출처다. */
const agents = new Map<string, Map<string, RunningAgent>>()

/**
 * 이 워크스페이스의 위임 실행을 전부 끊는다.
 *
 * 서브런은 세션이 아니라 메인에서 도므로 세션 정리로는 끊기지 않는다 — 여기서 안 끊으면
 * 사용자가 멈췄는데도 위임받은 에이전트가 계속 파일을 고친다.
 */
export function abortSubAgents(workspaceId: string): void {
  for (const [taskId, entry] of running) {
    if (entry.workspaceId !== workspaceId) continue
    entry.abort.abort()
    running.delete(taskId)
  }
}

/** 앱 종료·백엔드 정리 경로. */
export function abortAllSubAgents(): void {
  for (const entry of running.values()) entry.abort.abort()
  running.clear()
  agents.clear()
}

function emitAgents(deps: AgentToolDeps, workspaceId: string): void {
  const list = [...(agents.get(workspaceId)?.values() ?? [])]
  deps.emitChatEvent(workspaceId, { type: 'agents', agents: list })
}

function upsertAgent(deps: AgentToolDeps, workspaceId: string, agent: RunningAgent): void {
  let byWorkspace = agents.get(workspaceId)
  if (!byWorkspace) {
    byWorkspace = new Map()
    agents.set(workspaceId, byWorkspace)
  }
  byWorkspace.set(agent.taskId, { ...agent })
  emitAgents(deps, workspaceId)
}

/**
 * 도구 1건. 백엔드는 **이름에 박혀 있으므로** 인자가 아니라 등록 시점에 정해진다 —
 * 모델이 고를 수 있는 값이 아니어서 잘못된 백엔드가 올 수 없다.
 */
export function runDelegateTool(backend: AgentBackendId) {
  return async (
    deps: AgentToolDeps,
    workspaceId: string,
    args: Record<string, unknown>
  ): Promise<unknown> => {
    const settings = getStore().getState().settings
    const ws = getStore()
      .getState()
      .workspaces.find((w) => w.id === workspaceId)
    if (!ws) throw new Error(`Unknown Wooi workspace: ${workspaceId}`)

    // 요청마다 다시 확인한다 — 도구 정의는 세션을 열 때 정해지지만, 그 사이 사용자가 멀티
    // 에이전트 모드를 껐을 수 있다.
    if (!delegateBackendsFor(ws).includes(backend)) {
      throw new Error(
        `This workspace is not set up to run ${AGENT_BACKEND_LABELS[backend]} subagents. ` +
          // 켜는 길을 함께 적는다 — 이 실패를 보는 모델은 위임하려던 참이고, 그 길이 있다는
          // 것을 모르면 사용자에게 "할 수 없다" 고 답하고 끝낸다(Codex 경로는 도구가 늘 보이므로
          // 모드가 꺼진 채로 여기까지 온다).
          'If the user asked for the work to be split across agents, call ' +
          '`switch_to_agent_team` first.'
      )
    }

    const description = String(args.description ?? 'Delegated task')
    const prompt = String(args.prompt ?? '')
    if (!prompt.trim()) throw new Error('The subagent needs a prompt describing its task.')

    // 검증은 **사이드바에 행을 올리기 전에** 한다. 뒤로 미루면 거절된 호출이 "돌고 있는 서브에이전트"
    // 를 잠깐 그렸다 지우고, 사용자는 자기가 못 본 실행이 있었다고 읽는다.
    //
    // 지정하지 않은 축만 전역 기본값으로 떨어진다([[agent/multiAgent]] agentDefaultsFor). 둘 중
    // 하나만 고르는 것이 흔하기 때문이다 — "Haiku 로 훑되 강도는 평소대로" 에서 effort 까지
    // 기본값에서 떼어 내면 사용자가 설정해 둔 값이 조용히 사라진다.
    const requested = await validateAgentRunOptions(deps, backend, args)
    const defaults = agentDefaultsFor(settings)[backend] ?? { model: null, effort: null }
    const model = requested.model ?? defaults.model
    const effort = requested.effort ?? defaults.effort

    const taskId = randomUUID()
    const abort = new AbortController()
    running.set(taskId, { workspaceId, abort })

    const agent: RunningAgent = {
      taskId,
      // 위임 실행에는 이 호출을 가리키는 도구 id 가 없다(전송 계층이 이름과 인자만 나른다).
      // 그래서 taskId 를 그 자리에 쓴다 — Agents 패널이 자식 항목을 묶는 열쇠이기만 하면 되고,
      // 그 값이 어디서 왔는지는 상관없다([[shared/subagents]]).
      toolUseId: taskId,
      backend,
      agentType: AGENT_BACKEND_LABELS[backend],
      description,
      startedAt: Date.now(),
      toolUses: 0
    }
    upsertAgent(deps, workspaceId, agent)

    // Agents 패널의 행. 사이드바 목록(휘발성)과 달리 트랜스크립트에 남아, 끝난 뒤에도 무엇을
    // 시켰고 무엇을 했는지 다시 열어 볼 수 있다.
    const startedAt = Date.now()
    const row = (status: SubagentRow['status']): SubagentRow => ({
      id: `subagent:${taskId}`,
      type: 'subagent',
      toolId: taskId,
      backend,
      agentType: AGENT_BACKEND_LABELS[backend],
      description,
      status,
      toolUses: agent.toolUses,
      ...(status === 'running' ? {} : { durationMs: Date.now() - startedAt }),
      ts: startedAt
    })
    deps.postToTranscript(workspaceId, row('running'))

    // 자식 항목의 id. 활동은 순서만 있으면 되므로 단조 증가 카운터로 충분하다.
    let step = 0

    try {
      const result = await runSubAgent({
        backend,
        cwd: ws.worktreePath,
        repoPath: repoPathOf(ws),
        model,
        effort,
        // 위임된 실행이 부모보다 넓은 권한을 갖는 일은 없어야 한다.
        permissionMode: ws.permissionMode,
        prompt,
        abort,
        onActivity: (activity) => {
          if (activity.kind === 'tool') {
            agent.toolUses = (agent.toolUses ?? 0) + 1
            agent.lastToolName = activity.toolName ?? activity.text
          }
          upsertAgent(deps, workspaceId, agent)
          deps.postToTranscript(workspaceId, activityItem(taskId, step++, activity))
        },
        // Codex 서브런은 이 콜백을 쓰지 않는다 — `codex exec` 가 비대화형이라 승인 채널이 없고,
        // 그 경로에서는 샌드박스가 유일한 방어선이다.
        canUseTool: (toolName, input) => askSubAgentPermission(ws, backend, toolName, input),
        onUsage: (usage) => recordDelegatedUsage(workspaceId, usage)
      })

      if (result.error && !result.text) throw new Error(result.error)
      deps.postToTranscript(workspaceId, row(result.error ? 'failed' : 'completed'))
      // 아무 말도 없이 끝나는 경우가 있다(중단되었거나 도구만 돌리고 끝난 실행). 빈 문자열을
      // 그대로 돌려주면 모델이 성공으로 오해하므로 사실대로 적는다.
      return {
        text: result.text || `${AGENT_BACKEND_LABELS[backend]} finished without returning any text.`
      }
    } catch (err) {
      deps.postToTranscript(workspaceId, row(abort.signal.aborted ? 'stopped' : 'failed'))
      throw err
    } finally {
      running.delete(taskId)
      const byWorkspace = agents.get(workspaceId)
      if (byWorkspace?.delete(taskId)) emitAgents(deps, workspaceId)
    }
  }
}

type SubagentRow = Extract<ChatItem, { type: 'subagent' }>

/**
 * 위임 실행이 흘리는 활동 한 건을 Agents 패널이 그릴 항목으로 옮긴다.
 *
 * 네이티브 Task 만큼 자세하지는 않다 — `SubAgentActivity` 계약이 주는 것은 **요약 한 줄**이라
 * (`subagent/run.ts`) 도구의 실제 인자도, 결과 본문도 없다. 그래도 "무엇을 하는 중인지"는
 * 순서대로 남으므로, 사이드바 한 줄만 보고 결과를 기다리던 것과는 다르다.
 */
function activityItem(
  taskId: string,
  step: number,
  activity: { kind: 'text' | 'tool' | 'error'; text: string; toolName?: string }
): ChatItem {
  const id = `delegate:${taskId}:${step}`
  const ts = Date.now()
  if (activity.kind === 'tool') {
    return {
      id,
      type: 'tool_use',
      toolId: id,
      name: activity.toolName || 'Tool',
      // `description` 은 도구 카드가 요약으로 읽어 주는 키다([[shared/toolDisplay]]).
      input: { description: activity.text },
      ts,
      parentToolId: taskId
    }
  }
  if (activity.kind === 'error') {
    return { id, type: 'error', text: activity.text, ts, parentToolId: taskId }
  }
  return { id, type: 'assistant', text: activity.text, ts, parentToolId: taskId }
}

function repoPathOf(ws: Workspace): string | null {
  return (
    getStore()
      .getState()
      .repos.find((r) => r.id === ws.repoId)?.path ?? null
  )
}

/** 이 워크스페이스에서 등록해야 할 위임 도구 이름들(카탈로그와 짝을 맞추기 위한 노출). */
export function delegateToolBackends(ws: Workspace): AgentBackendId[] {
  return delegateBackendsFor(ws)
}

/** 진단용 — 지금 도는 위임 실행 수. */
export function runningSubAgents(): number {
  return running.size
}

export function logSubAgentError(err: unknown): void {
  log.error('subagent tool: run failed', err)
}
