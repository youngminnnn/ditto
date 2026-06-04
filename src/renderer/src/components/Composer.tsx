import { useEffect, useRef } from 'react'
import { Send, Square } from 'lucide-react'
import { useStore } from '../store'
import { PERMISSION_FOOTER } from '../lib/permission'
import type { ChatItem, Workspace } from '@shared/types'

export default function Composer({ workspace }: { workspace: Workspace }): React.JSX.Element {
  // 초안은 store 에 보관해 workspace 전환에도 살아남는다(작성 중 메시지 분실 방지).
  const text = useStore((s) => s.drafts[workspace.id] ?? '')
  const setDraft = useStore((s) => s.setDraft)
  const items = useStore((s) => s.transcripts[workspace.id]) ?? EMPTY
  const taRef = useRef<HTMLTextAreaElement>(null)
  // ↑ 로 이전 사용자 메시지를 불러올 때의 커서(끝에서부터). -1 = 미사용.
  const historyIdx = useRef(-1)
  const running = workspace.status === 'running'

  const setText = (v: string): void => setDraft(workspace.id, v)

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
    // 실행 중이어도 전송을 허용한다 — 세션 입력 큐에 적재돼 현재 응답 뒤에 이어 처리된다.
    void window.api.chat.send(workspace.id, trimmed)
    setText('')
    historyIdx.current = -1
  }

  const userMessages = (): string[] =>
    items.filter((i): i is Extract<ChatItem, { type: 'user' }> => i.type === 'user').map((i) => i.text)

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
      return
    }
    // 입력창이 비었거나 history 탐색 중일 때 ↑/↓ 로 이전 사용자 메시지 순회.
    if (e.key === 'ArrowUp' && (text === '' || historyIdx.current >= 0)) {
      const msgs = userMessages()
      if (!msgs.length) return
      e.preventDefault()
      const next = historyIdx.current < 0 ? msgs.length - 1 : Math.max(0, historyIdx.current - 1)
      historyIdx.current = next
      setText(msgs[next])
    } else if (e.key === 'ArrowDown' && historyIdx.current >= 0) {
      const msgs = userMessages()
      e.preventDefault()
      const next = historyIdx.current + 1
      if (next >= msgs.length) {
        historyIdx.current = -1
        setText('')
      } else {
        historyIdx.current = next
        setText(msgs[next])
      }
    }
  }

  return (
    <div className="shrink-0 px-4 py-3 border-t border-[#1c1f25]">
      <div className="max-w-3xl mx-auto flex items-end gap-2 bg-[#15171c] border border-[#23262d] rounded-xl px-3 py-2 focus-within:border-[#384050] transition-colors">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            historyIdx.current = -1
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            running
              ? 'Queue a follow-up…  (Enter to send · it runs after the current turn)'
              : 'Message Claude Code…  (Enter to send · Shift+Enter for newline)'
          }
          className="flex-1 bg-transparent resize-none outline-none text-[13px] leading-relaxed text-neutral-200 placeholder:text-neutral-600 py-1"
        />
        {running && (
          <button
            onClick={() => void window.api.chat.interrupt(workspace.id)}
            title="Stop the current turn"
            className="h-8 w-8 grid place-items-center rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25"
          >
            <Square size={15} fill="currentColor" />
          </button>
        )}
        <button
          onClick={send}
          disabled={!text.trim()}
          title={running ? 'Queue message' : 'Send'}
          className="h-8 w-8 grid place-items-center rounded-lg bg-blue-600 text-white disabled:bg-[#23262d] disabled:text-neutral-600 hover:bg-blue-500"
        >
          <Send size={15} />
        </button>
      </div>
      <div className="max-w-3xl mx-auto mt-1.5 px-1 text-[11px]">
        {(() => {
          const footer = PERMISSION_FOOTER[workspace.permissionMode]
          const accent = workspace.permissionMode === 'plan' ? 'text-cyan-400' : 'text-amber-400'
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

const EMPTY: ChatItem[] = []
