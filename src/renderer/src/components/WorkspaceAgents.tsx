import { ChevronDown, ChevronRight, Loader2, Square } from 'lucide-react'
import { useStore } from '../store'
import { formatDuration } from '../lib/format'
import { AgentBackendMark } from './BrandIcons'
import { AGENT_BACKEND_LABELS } from '@shared/types'
import { subagentRows } from '@shared/subagents'
import type { AgentBackendId, ChatItem, RunningAgent } from '@shared/types'

/** 끝난 실행을 사이드바에 몇 개까지 남길지. 더 오래된 것은 대화의 Task 카드로 들어간다. */
const RECENT_LIMIT = 5

/**
 * 사이드바에서 워크스페이스 행 **바로 아래**에 붙는, 이 워크트리의 서브에이전트 목록.
 *
 * 예전에는 "지금 돌고 있는 것"만 알리는 표시였다. 지금은 **들어가는 문**이다 — 행을 누르면 그
 * 서브에이전트의 대화가 열린다([[SubagentChatView]]). 그래서 끝난 것도 몇 개 남긴다: 끝나는
 * 순간 사라지면 방금 무엇을 알아냈는지 다시 볼 길이 사이드바에서 없어진다.
 *
 * **끝난 것은 지금 들어와 있는 워크스페이스에만 붙인다.** 사이드바는 "지금 무슨 일이 도는가" 를
 * 보는 곳이고, 워크스페이스마다 지난 이력이 꼬리처럼 쌓이면 그 성격이 사라진다. 다른 워크스페이스
 * 행에는 예전처럼 도는 것만 보인다.
 *
 * 워크스페이스 행 안이 아니라 형제로 렌더한다 — 행 자체가 role="button" 인 클릭·드래그 영역이라
 * 그 안에 버튼을 중첩하면 접기 클릭이 워크스페이스 선택으로 새고 드래그 정렬과도 충돌한다.
 */
export function WorkspaceAgents({
  workspaceId,
  /** 부모 워크스페이스 행의 stack 들여쓰기 깊이. 행과 같은 기준선에서 한 단계 더 들여쓴다. */
  depth,
  /**
   * 이 워크트리를 구동하는 에이전트 백엔드. 네이티브 서브에이전트(Claude 의 Task · Codex 의
   * collab)는 정의상 부모와 같은 백엔드라 이 값이 곧 그 행의 백엔드다.
   *
   * 위임(delegate)으로 띄운 교차 백엔드 실행만 자기 백엔드를 따로 싣고, 그때는 그 값이 이
   * 기본값을 이긴다 — 그래야 "Claude 워크스페이스인데 Codex 가 돌고 있다"가 보인다.
   */
  backend,
  now
}: {
  workspaceId: string
  depth: number
  backend: AgentBackendId
  now: number
}): React.JSX.Element | null {
  const live = useStore((s) => s.runningAgents[workspaceId])
  const items = useStore((s) => s.transcripts[workspaceId])
  const inThisWorkspace = useStore((s) => s.selectedWorkspaceId === workspaceId)
  const openToolId = useStore((s) =>
    s.selectedSubagent?.workspaceId === workspaceId ? s.selectedSubagent.toolId : null
  )
  const collapsed = useStore((s) => s.agentsCollapsed[workspaceId] ?? false)
  const toggle = useStore((s) => s.toggleAgentsCollapsed)
  // 설정이 로드되기 전(app === null)에는 켜진 것으로 본다 — 기본값이 켜짐이므로 첫 프레임에
  // 목록이 깜빡이며 사라지는 일이 없다.
  const enabled = useStore((s) => s.app?.settings.showRunningAgents ?? true)
  const open = useStore((s) => s.openSubagent)

  // 표시만 끈다 — main 은 계속 추적하므로 다시 켜면 지금 돌고 있는 것이 바로 나타난다.
  if (!enabled) return null

  const rows = buildRows(items, live, inThisWorkspace)
  if (rows.length === 0) return null

  const running = rows.filter((row) => row.running)
  // 접었을 때도 "몇 개가 얼마나 돌고 있나"는 남긴다 — 접기가 정보를 감추기만 하면 접어 둔 채로
  // 잊어버리게 된다. 도는 것이 없으면 셈의 대상은 남은 기록이다.
  const summary = running.length ? `${running.length} running` : `${rows.length} recent`
  const oldest = running[0]
  // 워크스페이스 행은 paddingLeft: 12 + depth*14 에 StatusDot(8px)+gap(8px) 이 앞에 온다.
  // 에이전트 행을 그 이름 텍스트와 같은 기준선에 맞춰 하위 항목으로 읽히게 한다.
  const indent = 12 + depth * 14 + 16

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => toggle(workspaceId)}
        style={{ paddingLeft: indent }}
        className="w-full flex items-center gap-1 pr-2 py-0.5 rounded-md text-xs text-neutral-500 hover:bg-[var(--surface)] hover:text-neutral-300 transition-colors"
        title={collapsed ? 'Show subagents' : 'Hide subagents'}
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        <span className="flex-1 text-left">{summary}</span>
        {collapsed && oldest && (
          <span className="tabular-nums text-neutral-600">
            {formatDuration(now - oldest.startedAt)}
          </span>
        )}
      </button>

      {!collapsed &&
        rows.map((row) => {
          // 위임 실행은 자기 백엔드를 싣고 오고, 네이티브 서브에이전트는 부모의 것을 따른다.
          const rowBackend = row.backend ?? backend
          const selected = row.toolId != null && row.toolId === openToolId
          const elapsed = row.running ? now - row.startedAt : row.durationMs
          return (
            <div
              key={row.key}
              style={{ paddingLeft: indent + 12 }}
              className={
                'flex items-baseline gap-1.5 pr-2 py-0.5 text-xs rounded-md ' +
                (selected ? 'bg-[var(--surface-2)]' : '')
              }
              title={[
                row.isTask
                  ? `Background task · ${row.agentType}`
                  : `${row.agentType} · ${AGENT_BACKEND_LABELS[rowBackend]}`,
                row.description,
                row.lastToolName ? `Last tool: ${row.lastToolName}` : null,
                typeof row.toolUses === 'number' ? `${row.toolUses} tool uses` : null,
                typeof row.totalTokens === 'number'
                  ? `${row.totalTokens.toLocaleString()} tokens`
                  : null,
                row.toolId
                  ? 'Click to open this subagent’s conversation'
                  : 'This run has no conversation to open'
              ]
                .filter(Boolean)
                .join('\n')}
            >
              {/* 이름과 설명 묶음만 버튼이다 — 행 전체를 버튼으로 만들면 옆의 중지 버튼이 버튼
                  안에 중첩된다. */}
              <button
                type="button"
                disabled={!row.toolId}
                onClick={() => row.toolId && void open(workspaceId, row.toolId)}
                aria-current={selected ? 'page' : undefined}
                className={
                  'min-w-0 flex-1 flex items-baseline gap-1.5 text-left ' +
                  (row.toolId ? 'hover:text-neutral-300' : 'cursor-default')
                }
              >
                {/* 좌측 마크가 "어떤 에이전트로 돌고 있나"(Claude Code / Codex)를, 옆 텍스트가
                    "어떤 서브에이전트인가"(Explore 등)를 나타낸다 — 두 축이 겹치지 않는다. */}
                {row.isTask ? (
                  <span className="shrink-0 text-neutral-500">●</span>
                ) : (
                  <span className="shrink-0 translate-y-0.5">
                    <AgentBackendMark backend={rowBackend} size={10} />
                  </span>
                )}
                {/* 타입 이름도 결국 잘린다 — `humanize-korean:translationese-research-distiller`
                    처럼 긴 이름이 오면 shrink-0 은 행을 사이드바 폭 밖으로 밀어내 경과 시간까지
                    잘라 먹는다. 설명이 먼저 0 폭으로 줄고(basis 0), 그래도 모자라면 여기서 준다. */}
                <span
                  className={
                    'min-w-0 truncate font-medium ' +
                    (selected ? 'text-neutral-200' : 'text-neutral-400')
                  }
                >
                  {row.agentType}
                </span>
                {/* 설명은 남는 폭만 차지하고 먼저 잘린다 — 타입·경과 시간이 항상 읽히는 쪽이 유용하다. */}
                <span className="min-w-0 flex-1 truncate text-neutral-600">
                  {row.lastToolName ? `${row.lastToolName} · ` : ''}
                  {row.description}
                </span>
              </button>
              {row.running && (
                <Loader2 size={9} className="shrink-0 animate-spin text-neutral-600" />
              )}
              {typeof elapsed === 'number' && (
                <span className="shrink-0 tabular-nums text-neutral-600">
                  {formatDuration(elapsed)}
                </span>
              )}
              {row.canStop && row.taskId && (
                <button
                  type="button"
                  aria-label={`Stop ${row.isTask ? 'background task' : 'agent'}: ${row.description}`}
                  title={`Stop ${row.isTask ? 'background task' : 'agent'}`}
                  onClick={() => void window.api.chat.stopTask(workspaceId, row.taskId!)}
                  className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-[var(--surface-2)] hover:text-[var(--danger-400)]"
                >
                  <Square size={9} fill="currentColor" />
                </button>
              )}
            </div>
          )
        })}
    </div>
  )
}

/** 사이드바 한 줄. 도는 것(휘발성)과 남은 기록(트랜스크립트)을 같은 모양으로 맞춘 것. */
interface AgentRow {
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
function buildRows(
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
