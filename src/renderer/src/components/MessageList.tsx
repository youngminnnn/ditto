import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ChevronRight, Wrench, Brain, AlertTriangle, Check, Copy, Loader2, ArrowDown } from 'lucide-react'
import { useStore } from '../store'
import { formatTime } from '../lib/format'
import type { ChatItem } from '@shared/types'

export default function MessageList({
  workspaceId,
  running
}: {
  workspaceId: string
  running: boolean
}): React.JSX.Element {
  const items = useStore((s) => s.transcripts[workspaceId]) ?? EMPTY
  // 스크롤 위치는 저장만 하고 구독하지 않는다(스크롤마다 재렌더 방지). 복원은 마운트 시 1회.
  const setScroll = useStore((s) => s.setScrollPosition)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  // 트랜스크립트는 비동기로 로드되므로, 내용이 처음 채워질 때 스크롤 위치를 1회 복원한다.
  const restoredRef = useRef(false)
  const [showJump, setShowJump] = useState(false)

  // 이 workspace 에서 결과가 도착한 tool_use id (진행 중 spinner 판별용).
  const resolved = new Set(
    items.filter((i) => i.type === 'tool_result').map((i) => (i as { toolId: string }).toolId)
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // 내용이 처음 채워지는 순간: 저장된 스크롤 위치가 있으면 복원(없으면 아래로).
    if (!restoredRef.current && items.length > 0) {
      restoredRef.current = true
      const saved = useStore.getState().scrollPositions[workspaceId]
      if (typeof saved === 'number') {
        el.scrollTop = saved
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
        atBottomRef.current = atBottom
        setShowJump(!atBottom)
        return
      }
    }

    // 그 외에는 사용자가 하단 근처일 때만 새 내용을 따라 내려간다.
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items, workspaceId])

  const onScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    atBottomRef.current = atBottom
    setShowJump(!atBottom)
    setScroll(workspaceId, el.scrollTop)
  }

  const jumpToBottom = (): void => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  if (items.length === 0) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto grid place-items-center">
        <p className="text-sm text-neutral-600">Send a message to start a Claude Code session.</p>
      </div>
    )
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-5 space-y-3">
          {items.map((item) => (
            <Item key={item.id} item={item} running={running} resolved={resolved} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      {showJump && (
        <button
          onClick={jumpToBottom}
          title="Jump to latest"
          className="absolute bottom-3 right-4 h-8 w-8 grid place-items-center rounded-full bg-[var(--surface-2)] border border-[var(--border-3)] text-neutral-300 hover:text-neutral-100 shadow-lg"
        >
          <ArrowDown size={15} />
        </button>
      )}
    </div>
  )
}

function Item({
  item,
  running,
  resolved
}: {
  item: ChatItem
  running: boolean
  resolved: Set<string>
}): React.JSX.Element | null {
  const time = formatTime(item.ts)
  switch (item.type) {
    case 'user':
      return (
        <div className="flex justify-end" title={time}>
          <div className="max-w-[85%] bg-[var(--surface-4)] text-neutral-100 rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] whitespace-pre-wrap">
            {item.text}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className="group/msg relative md text-[13px] text-neutral-200" title={time}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{ a: ExternalLinkRenderer, pre: PreWithCopy }}
          >
            {item.text || (item.streaming ? '…' : '')}
          </ReactMarkdown>
          {item.text && !item.streaming && (
            <div className="absolute -top-1 right-0 opacity-0 group-hover/msg:opacity-100 transition">
              <CopyButton text={item.text} />
            </div>
          )}
        </div>
      )
    case 'thinking':
      return <Thinking text={item.text} />
    case 'tool_use':
      return <ToolUse name={item.name} input={item.input} pending={running && !resolved.has(item.toolId)} />
    case 'tool_result':
      return <ToolResult text={item.text} isError={item.isError} />
    case 'result':
      return <ResultFooter item={item} />
    case 'error':
      return (
        <div className="flex items-center gap-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="whitespace-pre-wrap">{item.text}</span>
        </div>
      )
    case 'system':
      return <div className="text-[11.5px] text-neutral-500 text-center py-1">{item.text}</div>
    default:
      return null
  }
}

function Thinking({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[12px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-300"
      >
        <Brain size={12} />
        <span>Thinking</span>
        <ChevronRight size={12} className={open ? 'rotate-90 transition' : 'transition'} />
      </button>
      {open && (
        <div className="mt-1 pl-4 border-l border-[var(--border)] text-neutral-500 whitespace-pre-wrap italic">
          {text}
        </div>
      )}
    </div>
  )
}

function ToolUse({
  name,
  input,
  pending
}: {
  name: string
  input: unknown
  pending: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = summarizeToolInput(name, input)
  return (
    <div className="text-[12px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-200 w-full text-left"
      >
        {pending ? (
          <Loader2 size={12} className="text-amber-500/80 shrink-0 animate-spin" />
        ) : (
          <Wrench size={12} className="text-amber-500/80 shrink-0" />
        )}
        <span className="font-medium text-neutral-300">{name}</span>
        {summary && <span className="text-neutral-500 truncate">{summary}</span>}
        <ChevronRight size={12} className={(open ? 'rotate-90 ' : '') + 'ml-auto shrink-0 transition'} />
      </button>
      {open && (
        <pre className="mt-1 ml-4 text-[11.5px] bg-[var(--surface)] border border-[var(--border)] rounded-md p-2 overflow-x-auto text-neutral-400">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ToolResult({ text, isError }: { text: string; isError: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const lines = text.split('\n')
  const preview = lines.slice(0, 3).join('\n')
  const truncated = lines.length > 3 || text.length > 240

  return (
    <div className="ml-4 text-[11.5px]">
      <pre
        className={
          'whitespace-pre-wrap rounded-md p-2 overflow-x-auto border ' +
          (isError
            ? 'bg-red-500/5 border-red-500/20 text-red-300/90'
            : 'bg-[var(--bg-3)] border-[var(--border)] text-neutral-500')
        }
      >
        {open || !truncated ? text : preview + (truncated ? '\n…' : '')}
      </pre>
      {truncated && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-[11px] text-neutral-600 hover:text-neutral-400"
        >
          {open ? 'Collapse' : `Show more (${lines.length} lines)`}
        </button>
      )}
    </div>
  )
}

function ResultFooter({ item }: { item: Extract<ChatItem, { type: 'result' }> }): React.JSX.Element {
  const text =
    item.subtype === 'success'
      ? `${item.numTurns} turns · ${(item.durationMs / 1000).toFixed(1)}s · $${item.costUsd.toFixed(4)}`
      : `${item.subtype} · ${item.numTurns} turns`
  return (
    <div
      className={'text-[11px] text-center py-1 ' + (item.isError ? 'text-red-400/80' : 'text-neutral-600')}
    >
      {text}
    </div>
  )
}

/** 클립보드 복사 버튼(체크 표시로 피드백). */
function CopyButton({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <button
      onClick={copy}
      title="Copy"
      className={
        'h-6 w-6 grid place-items-center rounded-md bg-[var(--surface-2)]/80 text-neutral-400 hover:text-neutral-100 ' +
        (className ?? '')
      }
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  )
}

/** 코드 블록에 복사 버튼을 얹는다. */
function PreWithCopy({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="group/code relative">
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100 transition">
        <CopyButton text={extractText(children)} />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

/** React 노드 트리에서 텍스트만 모은다(코드 복사용). */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: React.ReactNode } }).props.children)
  }
  return ''
}

/** 채팅 메시지 안의 링크는 항상 사용자의 기본 브라우저로 연다(앱 내 이동 방지). */
function ExternalLinkRenderer({
  href,
  children
}: {
  href?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href) void window.api.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  if (name === 'Bash' && typeof obj.command === 'string') return obj.command
  if (typeof obj.file_path === 'string') return obj.file_path
  if (typeof obj.path === 'string') return obj.path
  if (typeof obj.pattern === 'string') return obj.pattern
  if (typeof obj.url === 'string') return obj.url
  if (typeof obj.description === 'string') return obj.description
  return ''
}

const EMPTY: ChatItem[] = []
