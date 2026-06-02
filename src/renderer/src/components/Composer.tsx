import { useEffect, useRef, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { PERMISSION_FOOTER } from '../lib/permission'
import type { Workspace } from '@shared/types'

export default function Composer({ workspace }: { workspace: Workspace }): React.JSX.Element {
  // 빈 문자열로 시작 — 새 세션에 자동 프롬프트를 넣지 않는다.
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const running = workspace.status === 'running'

  // textarea 높이 자동 조절.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [text])

  const send = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    void window.api.chat.send(workspace.id, trimmed)
    setText('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="shrink-0 px-4 py-3 border-t border-[#1c1f25]">
      <div className="max-w-3xl mx-auto flex items-end gap-2 bg-[#15171c] border border-[#23262d] rounded-xl px-3 py-2 focus-within:border-[#384050] transition-colors">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message Claude Code…  (Enter to send · Shift+Enter for newline)"
          className="flex-1 bg-transparent resize-none outline-none text-[13px] leading-relaxed text-neutral-200 placeholder:text-neutral-600 py-1"
        />
        {running ? (
          <button
            onClick={() => void window.api.chat.interrupt(workspace.id)}
            title="Stop"
            className="h-8 w-8 grid place-items-center rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25"
          >
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!text.trim()}
            title="Send"
            className="h-8 w-8 grid place-items-center rounded-lg bg-blue-600 text-white disabled:bg-[#23262d] disabled:text-neutral-600 hover:bg-blue-500"
          >
            <Send size={15} />
          </button>
        )}
      </div>
      <div className="max-w-3xl mx-auto mt-1.5 px-1 text-[11px]">
        {(() => {
          const footer = PERMISSION_FOOTER[workspace.permissionMode]
          const accent =
            workspace.permissionMode === 'plan' ? 'text-cyan-400' : 'text-amber-400'
          return footer ? (
            <span className={accent}>
              {footer.symbol} {footer.text}{' '}
              <span className="text-neutral-600">(shift+tab to cycle)</span>
            </span>
          ) : (
            <span className="text-neutral-600">shift+tab to cycle permission modes</span>
          )
        })()}
      </div>
    </div>
  )
}
