import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Loader2, Square } from 'lucide-react'
import { useStore } from '../store'
import { formatDuration } from '../lib/format'
import { useNow } from '../lib/useNow'
import { AgentBackendMark } from './BrandIcons'
import { AgentMessage } from './ChatPrimitives'
import { ToolCard } from './tools/ToolCard'
import { ToolGroupCard } from './tools/ToolGroupCard'
import { buildToolGroups } from '@shared/toolGroups'
import { subagentChildren, subagentRows, type SubagentRow } from '@shared/subagents'
import type { ChatItem } from '@shared/types'

/**
 * Agents 탭 — 이 워크스페이스가 띄운 서브에이전트마다 **그 자신의 대화**를 열어 볼 수 있는 곳.
 *
 * 왜 메인 대화가 아니라 여기인가. 서브에이전트는 정의상 병렬로 돈다 — 셋을 동시에 띄우면 셋의
 * 도구 호출이 시간순으로 뒤엉켜 도착한다. 그것을 부모 대화에 그대로 늘어놓으면 어느 줄이 누구의
 * 것인지 읽을 방법이 없다. 실행 단위로 갈라 두면 각 대화는 원래대로 한 줄기로 읽힌다.
 *
 * 부모 대화에는 `Task`/`Agent` 도구 카드가 그 자리를 지킨다 — "여기서 누구에게 무엇을 시켰다"는
 * 여전히 대화의 일부이고, "그가 무엇을 했는가"만 이 패널로 온다.
 *
 * 기록은 트랜스크립트 JSONL 에 함께 저장되므로([[shared/subagents]]) 앱을 껐다 켜도 남는다.
 */
export default function SubagentsPanel({
  workspaceId
}: {
  workspaceId: string
}): React.JSX.Element {
  const items = useStore((s) => s.transcripts[workspaceId])
  const rows = useMemo(() => subagentRows(items ?? []), [items])

  /**
   * 사용자가 손으로 토글한 행. 기본 펼침 규칙(도는 중이면 펼침)은 여기에 없는 행에만 적용한다 —
   * 접어 둔 행이 진행 갱신 한 번에 다시 열리면 접기가 아무 의미도 없어진다.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})

  // 사이드바 행·Task 카드에서 특정 서브에이전트를 지목해 들어온 경우. 그 행을 펼치고 그 자리로
  // 데려간다 — 패널만 열어 주면 스무 개 중에 어느 것이었는지 다시 찾아야 한다.
  const target = useStore((s) => s.agentsTarget)
  const targetToolId = target?.workspaceId === workspaceId && target.toolId ? target.toolId : null
  const targetSeq = target?.workspaceId === workspaceId ? target.seq : null

  // effect 가 아니라 렌더 중에 맞춘다. 명령이 도착한 그 렌더에서 이미 펼쳐진 화면을 그리므로
  // 접힌 상태가 한 프레임 깜빡이지 않고, 연쇄 렌더도 생기지 않는다.
  const [seenSeq, setSeenSeq] = useState<number | null>(null)
  if (targetSeq != null && targetSeq !== seenSeq) {
    setSeenSeq(targetSeq)
    if (targetToolId) setOverrides((prev) => ({ ...prev, [`subagent:${targetToolId}`]: true }))
  }

  // 도는 중인 것이 위. 끝난 것은 최근 순 — 방금 끝난 것을 가장 자주 다시 본다.
  const ordered = useMemo(() => {
    const running = rows.filter((row) => row.status === 'running')
    const done = rows.filter((row) => row.status !== 'running').reverse()
    return [...running, ...done]
  }, [rows])

  const anyRunning = ordered.some((row) => row.status === 'running')
  const now = useNow(1000, anyRunning)

  if (!ordered.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-neutral-500">
        <Bot size={22} />
        <p className="text-sm">No subagents yet</p>
        <p className="text-xs text-neutral-600">
          When the agent delegates work, each run shows up here with its own conversation.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-2 space-y-1.5">
      {ordered.map((row) => (
        <SubagentSection
          key={row.id}
          workspaceId={workspaceId}
          row={row}
          items={items ?? []}
          now={now}
          open={overrides[row.id] ?? row.status === 'running'}
          onToggle={() =>
            setOverrides((prev) => ({
              ...prev,
              [row.id]: !(prev[row.id] ?? row.status === 'running')
            }))
          }
          scrollToSeq={targetToolId === row.toolId ? targetSeq : null}
        />
      ))}
    </div>
  )
}

const STATUS_LABEL: Record<SubagentRow['status'], string> = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
  stopped: 'stopped'
}

const STATUS_CLASS: Record<SubagentRow['status'], string> = {
  running: 'text-neutral-400',
  completed: 'text-neutral-500',
  failed: 'text-[var(--danger-400)]',
  stopped: 'text-neutral-500'
}

function SubagentSection({
  workspaceId,
  row,
  items,
  now,
  open,
  onToggle,
  scrollToSeq
}: {
  workspaceId: string
  row: SubagentRow
  items: ChatItem[]
  now: number
  open: boolean
  onToggle: () => void
  /** 값이 바뀌면 이 행으로 스크롤한다(null 이면 지목당한 행이 아니다). */
  scrollToSeq: number | null
}): React.JSX.Element {
  const running = row.status === 'running'
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollToSeq == null) return
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [scrollToSeq])
  // 접혀 있으면 자식을 훑지도 않는다 — 도구 묶음 계산은 항목 수에 비례하고, 끝난 서브에이전트가
  // 수십 개 쌓인 패널에서 그걸 전부 돌릴 이유가 없다.
  const children = useMemo(
    () => (open ? subagentChildren(items, row.toolId) : []),
    [open, items, row.toolId]
  )

  const elapsed = running ? now - row.ts : row.durationMs
  const facts = [
    typeof row.toolUses === 'number' ? `${row.toolUses} tool uses` : null,
    typeof row.totalTokens === 'number' ? `${row.totalTokens.toLocaleString()} tokens` : null,
    typeof elapsed === 'number' ? formatDuration(elapsed) : null
  ].filter(Boolean)

  return (
    // 대화 항목과 같은 표식을 단다 — 이 패널의 행도 결국 트랜스크립트의 한 항목이고,
    // 검색·점프·e2e 가 자리를 찾는 방법이 두 벌이 되지 않는 편이 낫다.
    <div
      ref={ref}
      data-item-id={row.id}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {/* 좌측 마크는 "무엇이 돌고 있나"(Claude Code / Codex), 옆 텍스트는 "어떤 서브에이전트인가".
              사이드바의 실행 중 목록과 같은 두 축이라 눈이 옮겨 가도 다시 배울 것이 없다. */}
          <span className="shrink-0">
            <AgentBackendMark backend={row.backend} size={11} />
          </span>
          <span className="shrink-0 text-xs font-medium text-neutral-300">{row.agentType}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">
            {row.description}
          </span>
        </button>
        {running && <Loader2 size={11} className="shrink-0 animate-spin text-neutral-500" />}
        <span className={`shrink-0 text-[11px] ${STATUS_CLASS[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
        {running && row.taskId && (
          <button
            type="button"
            aria-label={`Stop subagent: ${row.description}`}
            title="Stop subagent"
            onClick={() => void window.api.chat.stopTask(workspaceId, row.taskId!)}
            className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-[var(--surface-2)] hover:text-[var(--danger-400)]"
          >
            <Square size={9} fill="currentColor" />
          </button>
        )}
      </div>

      {facts.length > 0 && (
        <div className="px-2 pb-1.5 pl-[26px] text-[11px] tabular-nums text-neutral-600">
          {facts.join(' · ')}
        </div>
      )}

      {open && (
        <div className="border-t border-[var(--border)] px-2 py-2">
          <SubagentTranscript items={children} backend={row.backend} running={running} />
        </div>
      )}
    </div>
  )
}

/**
 * 서브에이전트 한 명의 대화. 부모 대화의 렌더링 부품을 그대로 쓴다 — 도구 카드가 여기서만 다르게
 * 생기면 같은 도구를 두 번 배워야 한다.
 *
 * `MessageList` 를 재사용하지 않는 이유는 그쪽이 대화 **화면**이기 때문이다(검색·점프·밀도·
 * 페이지네이션·스크롤 앵커). 여기서 필요한 것은 항목을 순서대로 그리는 일뿐이라, 화면 살림을
 * 통째로 끌어오면 두 벌의 스크롤과 두 벌의 단축키가 겹친다.
 */
function SubagentTranscript({
  items,
  backend,
  running
}: {
  items: ChatItem[]
  backend: SubagentRow['backend']
  running: boolean
}): React.JSX.Element {
  const toolLogStyle = useStore((s) => s.app?.settings.toolLogStyle ?? 'wooi')
  const { groupByItemId, hiddenItemIds } = useMemo(() => buildToolGroups(items), [items])

  const { visible, results } = useMemo(() => {
    const resultByToolId = new Map<string, Extract<ChatItem, { type: 'tool_result' }>>()
    const uses = new Set(items.filter((it) => it.type === 'tool_use').map((it) => it.toolId))
    for (const it of items) if (it.type === 'tool_result') resultByToolId.set(it.toolId, it)
    return {
      // 결과는 자기 호출 카드 안으로 들어가므로 따로 놓지 않는다(부모 대화와 같은 규칙).
      visible: items.filter(
        (it) => !hiddenItemIds.has(it.id) && !(it.type === 'tool_result' && uses.has(it.toolId))
      ),
      results: resultByToolId
    }
  }, [items, hiddenItemIds])

  if (!visible.length) {
    return (
      <p className="text-xs text-neutral-600">
        {running
          ? 'Waiting for the first step…'
          : backend === 'codex'
            ? // 없는 것을 있는 척하지 않는다 — Codex 는 서브에이전트의 내부 대화를 프로토콜로
              // 내보내지 않으므로(agentThreadId·agentPath 만 온다) 채울 재료 자체가 없다.
              'Codex does not stream a subagent’s own conversation — only that it ran.'
            : 'This run finished without leaving any steps.'}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {visible.map((item) => {
        const group = groupByItemId.get(item.id)
        if (group) {
          return (
            <ToolGroupCard
              key={item.id}
              group={group}
              results={results}
              style={toolLogStyle}
              verbose={false}
            />
          )
        }
        if (item.type === 'tool_use') {
          return (
            <ToolCard
              key={item.id}
              use={item}
              result={results.get(item.toolId)}
              pending={!results.has(item.toolId)}
              style={toolLogStyle}
              verbose={false}
            />
          )
        }
        if (item.type === 'assistant') {
          return <AgentMessage key={item.id} text={item.text} />
        }
        if (item.type === 'thinking') {
          return (
            <p key={item.id} className="whitespace-pre-wrap text-xs italic text-neutral-500">
              {item.text}
            </p>
          )
        }
        return null
      })}
    </div>
  )
}
