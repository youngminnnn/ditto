import { useEffect, useMemo, useRef, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { useStore } from '../store'
import type { PermissionRequest } from '@shared/types'

interface QuestionOption {
  label: string
  description: string
  preview?: string
}

interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect?: boolean
}

// 사용자가 직접 입력한 "Other" 항목을 selected 배열 안에서 표시하는 sentinel.
// Other 는 모델이 준 옵션이 아니라 자동 제공되는 자유 입력이므로, 실제 옵션 라벨과
// 한 배열에 섞여도 충돌하지 않도록, 실제 라벨로는 나올 수 없는 토큰 값을 쓴다.
const OTHER = '__ditto_other__'

/**
 * AskUserQuestion 도구의 질문을 표시하고 사용자의 선택을 수집한다.
 *
 * AskUserQuestion 은 행위 승인이 아니라 사용자에게 답을 요청하는 도구이므로 Allow/Deny
 * 프롬프트(PermissionPrompt) 대신 옵션 선택 UI 를 띄운다. 수집한 답은 도구가 기대하는
 * answers 맵(질문 텍스트 → 선택 라벨, 복수 선택은 쉼표 구분)으로 만들어 updatedInput 에
 * 실어 되돌려준다. 빈 답으로 넘기면 모델이 "사용자가 답하지 않았다" 며 진행하기 때문이다.
 */
export default function QuestionPrompt({
  request
}: {
  request: PermissionRequest
}): React.JSX.Element {
  const dismiss = useStore((s) => s.dismissPermission)
  const firstRef = useRef<HTMLButtonElement>(null)

  const questions = useMemo<Question[]>(() => {
    const q = (request.input as { questions?: unknown }).questions
    return Array.isArray(q) ? (q as Question[]) : []
  }, [request])

  // 질문 인덱스별 선택된 옵션 라벨 목록(+ OTHER sentinel)과 Other 자유 입력 텍스트.
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [otherText, setOtherText] = useState<Record<number, string>>({})

  // 첫 옵션에 포커스하고 Esc=취소를 바인딩한다. ChatView 가 requestId 를 key 로 주어
  // 질문이 바뀌면 컴포넌트가 새로 마운트되므로 입력 상태는 자동으로 초기화된다.
  useEffect(() => {
    firstRef.current?.focus()

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId])

  const toggle = (qi: number, value: string, multi: boolean): void => {
    setSelected((prev) => {
      const cur = prev[qi] ?? []
      if (multi) {
        const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
        return { ...prev, [qi]: next }
      }
      return { ...prev, [qi]: [value] }
    })
  }

  const setOther = (qi: number, text: string, multi: boolean): void => {
    setOtherText((prev) => ({ ...prev, [qi]: text }))
    // 자유 입력을 시작하면 Other 를 선택 상태로(단일 선택은 다른 선택을 대체), 비우면 해제한다.
    setSelected((prev) => {
      const cur = prev[qi] ?? []
      const has = cur.includes(OTHER)
      if (text && !has) return { ...prev, [qi]: multi ? [...cur, OTHER] : [OTHER] }
      if (!text && has) return { ...prev, [qi]: cur.filter((v) => v !== OTHER) }
      return prev
    })
  }

  // 한 질문의 최종 답 문자열: 선택 라벨(Other 는 입력 텍스트)을 쉼표로 잇는다.
  const answerFor = (qi: number): string =>
    (selected[qi] ?? [])
      .map((v) => (v === OTHER ? (otherText[qi] ?? '').trim() : v))
      .filter(Boolean)
      .join(', ')

  const allAnswered = questions.length > 0 && questions.every((_, qi) => answerFor(qi).length > 0)

  const submit = (): void => {
    if (!allAnswered) return

    const answers: Record<string, string> = {}
    questions.forEach((q, qi) => {
      answers[q.question] = answerFor(qi)
    })

    void window.api.permission.respond(request.requestId, {
      behavior: 'allow',
      updatedInput: { ...(request.input as Record<string, unknown>), answers }
    })
    dismiss(request.requestId)
  }

  const cancel = (): void => {
    void window.api.permission.respond(request.requestId, { behavior: 'deny' })
    dismiss(request.requestId)
  }

  return (
    <div className="shrink-0 mx-4 mb-2 rounded-lg border border-[var(--brand-500)]/30 bg-[var(--brand-500)]/10 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <MessagesSquare size={16} className="text-[var(--brand-400)] mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {questions.map((q, qi) => {
            const multi = Boolean(q.multiSelect)
            const cur = selected[qi] ?? []
            return (
              <div key={qi} className={qi > 0 ? 'mt-3.5' : ''}>
                <div className="text-sm text-neutral-100 font-medium">{q.question}</div>
                {multi && (
                  <div className="text-xs text-[var(--brand-300)]/70 mt-0.5">Select all that apply</div>
                )}
                <div className="mt-1.5 flex flex-col gap-1">
                  {q.options.map((opt, oi) => {
                    const on = cur.includes(opt.label)
                    return (
                      <button
                        key={oi}
                        ref={qi === 0 && oi === 0 ? firstRef : undefined}
                        onClick={() => toggle(qi, opt.label, multi)}
                        className={`text-left rounded-md border px-2.5 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--brand-300)]/50 ${
                          on
                            ? 'border-[var(--brand-400)]/60 bg-[var(--brand-500)]/15'
                            : 'border-neutral-700/60 hover:bg-[var(--surface-2)]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block h-3 w-3 shrink-0 border ${
                              multi ? 'rounded-[3px]' : 'rounded-full'
                            } ${on ? 'bg-[var(--brand-400)] border-[var(--brand-400)]' : 'border-neutral-500'}`}
                          />
                          <span className="text-sm text-neutral-100">{opt.label}</span>
                        </div>
                        {opt.description && (
                          <div className="text-xs text-neutral-400 mt-0.5 ml-5">
                            {opt.description}
                          </div>
                        )}
                      </button>
                    )
                  })}

                  {/* 자동 제공되는 Other 자유 입력. */}
                  <input
                    type="text"
                    value={otherText[qi] ?? ''}
                    onChange={(e) => setOther(qi, e.target.value, multi)}
                    placeholder="Other…"
                    className={`text-sm rounded-md border bg-transparent px-2.5 py-1.5 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand-300)]/50 ${
                      cur.includes(OTHER)
                        ? 'border-[var(--brand-400)]/60 bg-[var(--brand-500)]/10'
                        : 'border-neutral-700/60'
                    }`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          onClick={cancel}
          className="text-sm px-2.5 py-1 rounded-md text-neutral-300 hover:bg-[var(--surface-2)]"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!allAnswered}
          className="text-sm px-2.5 py-1 rounded-md bg-[var(--brand-500)]/90 text-black font-medium hover:bg-[var(--brand-400)] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--brand-300)]/60"
        >
          Submit
        </button>
      </div>
    </div>
  )
}
