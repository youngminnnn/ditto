import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ChevronRight, Wrench, Brain, AlertTriangle } from 'lucide-react'
import { useStore } from '../store'
import type { ChatItem } from '@shared/types'

export default function MessageList({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const items = useStore((s) => s.transcripts[workspaceId]) ?? []
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 새 내용이 추가되면 하단으로 스크롤 (사용자가 위로 올려둔 경우는 방해하지 않음).
  const lastLen = items.length
  const lastText = items.length ? JSON.stringify(items[items.length - 1]).length : 0
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lastLen, lastText])

  if (items.length === 0) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto grid place-items-center">
        <p className="text-sm text-neutral-600">Send a message to start a Claude Code session.</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-5 py-5 space-y-3">
        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function Item({ item }: { item: ChatItem }): React.JSX.Element | null {
  switch (item.type) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] bg-[#1f2630] text-neutral-100 rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] whitespace-pre-wrap">
            {item.text}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className="md text-[13px] text-neutral-200">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{ a: ExternalLinkRenderer }}
          >
            {item.text || (item.streaming ? '…' : '')}
          </ReactMarkdown>
        </div>
      )
    case 'thinking':
      return <Thinking text={item.text} />
    case 'tool_use':
      return <ToolUse name={item.name} input={item.input} />
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
        <div className="mt-1 pl-4 border-l border-[#23262d] text-neutral-500 whitespace-pre-wrap italic">
          {text}
        </div>
      )}
    </div>
  )
}

function ToolUse({ name, input }: { name: string; input: unknown }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = summarizeToolInput(name, input)
  return (
    <div className="text-[12px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-200 w-full text-left"
      >
        <Wrench size={12} className="text-amber-500/80 shrink-0" />
        <span className="font-medium text-neutral-300">{name}</span>
        {summary && <span className="text-neutral-500 truncate">{summary}</span>}
        <ChevronRight size={12} className={(open ? 'rotate-90 ' : '') + 'ml-auto shrink-0 transition'} />
      </button>
      {open && (
        <pre className="mt-1 ml-4 text-[11.5px] bg-[#15171c] border border-[#23262d] rounded-md p-2 overflow-x-auto text-neutral-400">
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
            : 'bg-[#101216] border-[#1c1f25] text-neutral-500')
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

function ResultFooter({
  item
}: {
  item: Extract<ChatItem, { type: 'result' }>
}): React.JSX.Element {
  const text =
    item.subtype === 'success'
      ? `${item.numTurns} turns · ${(item.durationMs / 1000).toFixed(1)}s · $${item.costUsd.toFixed(4)}`
      : `${item.subtype} · ${item.numTurns} turns`
  return (
    <div
      className={
        'text-[11px] text-center py-1 ' + (item.isError ? 'text-red-400/80' : 'text-neutral-600')
      }
    >
      {text}
    </div>
  )
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
