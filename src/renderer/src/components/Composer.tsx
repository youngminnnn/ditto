import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Square, Terminal as TerminalIcon, MessageCircleQuestion, X, ImageIcon } from 'lucide-react'
import { useStore } from '../store'
import { PERMISSION_FOOTER } from '../lib/permission'
import type { ChatItem, ImageAttachment, ImageMediaType, SlashCommandInfo, Workspace } from '@shared/types'

/** Claude 가 받는 이미지 형식. 클립보드의 다른 형식은 붙여넣기 시 무시한다. */
const IMAGE_TYPES: Record<string, ImageMediaType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp'
}

/** 화면에 띄우는 붙여넣기 이미지: 전송용 base64 + 썸네일용 data URL. */
type PendingImage = ImageAttachment & { id: string; previewUrl: string }

/** Blob → 순수 base64(+data URL). FileReader 로 읽어 "data:...;base64," 접두사를 떼어 본문만 남긴다. */
function readImage(blob: Blob): Promise<{ dataBase64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      resolve({ dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1), dataUrl })
    }
    reader.onerror = () => reject(reader.error ?? new Error('image read failed'))
    reader.readAsDataURL(blob)
  })
}

export default function Composer({ workspace }: { workspace: Workspace }): React.JSX.Element {
  // 초안은 store 에 보관해 workspace 전환에도 살아남는다(작성 중 메시지 분실 방지).
  const text = useStore((s) => s.drafts[workspace.id] ?? '')
  const setDraft = useStore((s) => s.setDraft)
  const items = useStore((s) => s.transcripts[workspace.id]) ?? EMPTY
  const taRef = useRef<HTMLTextAreaElement>(null)
  // ↑ 로 이전 사용자 메시지를 불러올 때의 커서(끝에서부터). -1 = 미사용.
  const historyIdx = useRef(-1)
  const running = workspace.status === 'running'

  // 슬래시 명령 자동완성: 명령 목록(워크스페이스당 1회 조회)과 메뉴 선택 인덱스.
  const [commands, setCommands] = useState<SlashCommandInfo[] | null>(null)
  const [loadingCommands, setLoadingCommands] = useState(false)
  const [menuIdx, setMenuIdx] = useState(0)

  // /btw 사이드 질문의 임시 답변(트랜스크립트와 분리, 닫으면 사라짐).
  const [sideAnswer, setSideAnswer] = useState<SideAnswer | null>(null)

  // 붙여넣은 이미지 첨부(전송 전 대기). 초안과 달리 워크스페이스 전환 시 비운다(다른 작업으로 새지 않도록).
  const [images, setImages] = useState<PendingImage[]>([])
  // 같은 워크스페이스 안에서 첨부 id 가 겹치지 않도록 하는 단조 카운터.
  const imgSeq = useRef(0)

  // 워크스페이스를 바꾸면 이전 사이드 답변과 대기 중 첨부를 치운다(다른 작업으로 새지 않도록).
  useEffect(() => {
    setSideAnswer(null)
    setImages([])
  }, [workspace.id])

  const removeImage = (id: string): void => setImages((prev) => prev.filter((i) => i.id !== id))

  /** 클립보드의 이미지를 첨부로 받는다. 이미지가 하나라도 있으면 기본 텍스트 붙여넣기를 막는다. */
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file' && IMAGE_TYPES[it.type])
      .map((it) => ({ mediaType: IMAGE_TYPES[it.type], file: it.getAsFile() }))
      .filter((x): x is { mediaType: ImageMediaType; file: File } => x.file != null)
    if (!files.length) return // 텍스트 붙여넣기는 그대로 둔다.

    e.preventDefault()
    for (const { mediaType, file } of files) {
      const id = `img:${imgSeq.current++}`
      const ext = mediaType.split('/')[1]
      const name = file.name && file.name !== 'image.png' ? file.name : `image-${imgSeq.current}.${ext}`
      void readImage(file).then(({ dataBase64, dataUrl }) => {
        setImages((prev) => [...prev, { id, name, mediaType, dataBase64, previewUrl: dataUrl }])
      })
    }
  }

  // 사이드 질문 스트림 구독. 현재 워크스페이스의 이벤트만, id 로 스트림을 구분해 반영한다.
  useEffect(() => {
    return window.api.onSideQuestion((e) => {
      if (e.workspaceId !== workspace.id) return
      setSideAnswer((prev) => {
        if (e.phase === 'start') return { id: e.id, question: e.question, text: '', status: 'streaming' }
        if (!prev || prev.id !== e.id) return prev
        if (e.phase === 'delta') return { ...prev, text: prev.text + e.text }
        if (e.phase === 'done') return { ...prev, status: 'done' }
        return { ...prev, status: 'error', error: e.message }
      })
    })
  }, [workspace.id])

  const setText = (v: string): void => setDraft(workspace.id, v)

  // textarea 높이 자동 조절.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [text])

  // 입력이 "/명령이름" 단계(아직 공백 없음)인지. 이때만 자동완성 메뉴를 띄운다.
  const slashQuery = useMemo(() => {
    const m = /^\/(\S*)$/.exec(text)
    return m ? m[1] : null
  }, [text])

  // 슬래시 모드 진입 시 명령 목록을 lazy 하게 조회한다.
  useEffect(() => {
    if (slashQuery === null || commands !== null || loadingCommands) return
    setLoadingCommands(true)
    void window.api.commands.list(workspace.id).then((list) => {
      setCommands(list)
      setLoadingCommands(false)
    })
  }, [slashQuery, commands, loadingCommands, workspace.id])

  // 접두사 우선, 없으면 부분일치로 필터링. 접두사 매치를 위로 올린다.
  const matches = useMemo(() => {
    if (slashQuery === null || !commands) return []
    const q = slashQuery.toLowerCase()
    const scored = commands
      .map((c) => {
        const name = c.name.toLowerCase()
        const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2
        return { c, rank }
      })
      .filter((x) => x.rank < 2)
      .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name))
    return scored.map((x) => x.c)
  }, [slashQuery, commands])

  const menuOpen = slashQuery !== null && (loadingCommands || matches.length > 0)

  useEffect(() => {
    setMenuIdx(0)
  }, [slashQuery])

  const send = (): void => {
    const trimmed = text.trim()
    if (!trimmed && !images.length) return // 텍스트도 첨부도 없으면 무시.

    // /btw 는 사이드 질문으로 분기한다 — 일반 메시지로 보내면 현재 턴 뒤에 큐잉되어 메인 대화에
    // 쌓이므로(=오염), 맥락만 공유하는 임시 질의로 처리하고 답변은 별도 카드로 보여 준다.
    // (사이드 질문은 텍스트 전용 — 첨부가 있으면 일반 메시지로 보낸다.)
    const sideQ = images.length ? null : /^\/btw(?:\s+([\s\S]+))?$/.exec(trimmed)
    if (sideQ) {
      const question = (sideQ[1] ?? '').trim()
      if (!question) return // 질문 없이 "/btw" 만 보낸 경우는 무시.
      void window.api.chat.sideQuestion(workspace.id, question)
      setText('')
      historyIdx.current = -1
      return
    }

    // 첨부에서 화면 전용 필드(id·previewUrl)를 떼고 전송용 payload 만 보낸다.
    const payload: ImageAttachment[] = images.map(({ name, mediaType, dataBase64 }) => ({
      name,
      mediaType,
      dataBase64
    }))
    // 실행 중이어도 전송을 허용한다 — 세션 입력 큐에 적재돼 현재 응답 뒤에 이어 처리된다.
    void window.api.chat.send(workspace.id, trimmed, payload.length ? payload : undefined)
    setText('')
    setImages([])
    historyIdx.current = -1
  }

  /** 선택한 슬래시 명령을 입력창에 채운다(인자를 이어 쓸 수 있도록 공백을 붙이고 포커스 유지). */
  const acceptCommand = (cmd: SlashCommandInfo): void => {
    setText(`/${cmd.name} `)
    historyIdx.current = -1
    taRef.current?.focus()
  }

  const userMessages = (): string[] =>
    items.filter((i): i is Extract<ChatItem, { type: 'user' }> => i.type === 'user').map((i) => i.text)

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // 슬래시 메뉴가 열려 있으면 방향키/Enter/Tab 을 메뉴 조작에 먼저 쓴다.
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (matches.length) setMenuIdx((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (matches.length) setMenuIdx((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // 명령 입력을 비워 메뉴를 닫는다.
        setText('')
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        const cmd = matches[menuIdx]
        if (cmd) {
          e.preventDefault()
          acceptCommand(cmd)
          return
        }
      }
    }

    // 사이드 답변 카드가 떠 있으면 Esc 로 닫는다(메뉴가 우선).
    if (e.key === 'Escape' && sideAnswer && !menuOpen) {
      e.preventDefault()
      setSideAnswer(null)
      return
    }

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
    <div className="shrink-0 px-4 py-3 border-t border-[var(--border)]">
      <div className="max-w-3xl mx-auto relative">
        {menuOpen && (
          <SlashMenu
            matches={matches}
            loading={loadingCommands && matches.length === 0}
            selectedIdx={menuIdx}
            onHover={setMenuIdx}
            onPick={acceptCommand}
          />
        )}
        {sideAnswer && !menuOpen && (
          <SideAnswerCard answer={sideAnswer} onClose={() => setSideAnswer(null)} />
        )}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2 focus-within:border-[var(--border-strong)] transition-colors">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {images.map((img) => (
                <ImageChip key={img.id} img={img} onRemove={() => removeImage(img.id)} />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                historyIdx.current = -1
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              placeholder={
                running
                  ? 'Queue a follow-up…  (Enter to send · it runs after the current turn)'
                  : 'Message Claude Code…  (Enter to send · / for commands · paste an image)'
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
              disabled={!text.trim() && images.length === 0}
              title={running ? 'Queue message' : 'Send'}
              className="h-8 w-8 grid place-items-center rounded-lg bg-blue-600 text-white disabled:bg-[var(--border)] disabled:text-neutral-600 hover:bg-blue-500"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
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

/** 전송 대기 중인 붙여넣기 이미지 칩(썸네일 + 이름 + 제거). */
function ImageChip({
  img,
  onRemove
}: {
  img: PendingImage
  onRemove: () => void
}): React.JSX.Element {
  return (
    <div className="group/chip relative flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg bg-[var(--surface-3)] border border-[var(--border)]">
      <img src={img.previewUrl} alt={img.name} className="h-7 w-7 rounded object-cover" />
      <ImageIcon size={11} className="text-neutral-500 shrink-0" />
      <span className="text-[11px] text-neutral-300 max-w-[140px] truncate">{img.name}</span>
      <button
        onClick={onRemove}
        title="Remove image"
        className="ml-0.5 shrink-0 h-4 w-4 grid place-items-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-[var(--surface-4)]"
      >
        <X size={12} />
      </button>
    </div>
  )
}

/** 입력창 위에 뜨는 슬래시 명령 자동완성 목록(Claude Code 스타일). */
function SlashMenu({
  matches,
  loading,
  selectedIdx,
  onHover,
  onPick
}: {
  matches: SlashCommandInfo[]
  loading: boolean
  selectedIdx: number
  onHover: (idx: number) => void
  onPick: (cmd: SlashCommandInfo) => void
}): React.JSX.Element {
  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-3)] shadow-2xl py-1 z-20">
      {loading ? (
        <div className="px-3 py-2 text-[12px] text-neutral-500">Loading commands…</div>
      ) : (
        matches.map((cmd, i) => {
          const active = i === selectedIdx
          return (
            <button
              key={cmd.name}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                // textarea 가 blur 되지 않도록 기본 동작을 막고 직접 처리.
                e.preventDefault()
                onPick(cmd)
              }}
              className={
                'w-full flex items-baseline gap-2 px-3 py-1.5 text-left ' +
                (active ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface)]')
              }
            >
              <TerminalIcon size={12} className="text-violet-400 shrink-0 translate-y-0.5" />
              <span className="text-[12.5px] font-medium text-neutral-100 shrink-0">/{cmd.name}</span>
              {cmd.argumentHint && (
                <span className="text-[11px] text-neutral-500 shrink-0">{cmd.argumentHint}</span>
              )}
              {cmd.description && (
                <span className="text-[11px] text-neutral-500 truncate">{cmd.description}</span>
              )}
            </button>
          )
        })
      )}
    </div>
  )
}

/** /btw 사이드 답변의 임시 상태(트랜스크립트에 저장되지 않음). */
type SideAnswer = {
  id: string
  question: string
  text: string
  status: 'streaming' | 'done' | 'error'
  error?: string
}

/**
 * 입력창 위에 뜨는 /btw 사이드 답변 카드.
 * 메인 대화와 분리된 임시 표시 — 닫으면(Esc/✕) 사라지고 기록에 남지 않는다.
 */
function SideAnswerCard({
  answer,
  onClose
}: {
  answer: SideAnswer
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 max-h-80 overflow-y-auto rounded-xl border border-violet-500/30 bg-[var(--bg-3)] shadow-2xl z-20">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-3)]">
        <MessageCircleQuestion size={13} className="text-violet-400 shrink-0" />
        <span className="text-[11px] font-medium text-violet-300 shrink-0">Side question</span>
        <span className="text-[11px] text-neutral-500 truncate">{answer.question}</span>
        <button
          onClick={onClose}
          title="Dismiss (Esc)"
          className="ml-auto shrink-0 h-5 w-5 grid place-items-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-[var(--surface-3)]"
        >
          <X size={13} />
        </button>
      </div>
      <div className="px-3 py-2 text-[12.5px] leading-relaxed text-neutral-200 whitespace-pre-wrap">
        {answer.status === 'error' ? (
          <span className="text-red-400">{answer.error || 'Side question failed.'}</span>
        ) : (
          <>
            {answer.text}
            {answer.status === 'streaming' && (
              <span className="text-neutral-500">{answer.text ? ' ▍' : 'Thinking…'}</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const EMPTY: ChatItem[] = []
