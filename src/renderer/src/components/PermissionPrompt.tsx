import { useEffect, useRef } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { useStore } from '../store'
import { summarizePermission } from '../lib/permission'
import type { PermissionRequest } from '@shared/types'

export default function PermissionPrompt({
  request
}: {
  request: PermissionRequest
}): React.JSX.Element {
  const dismiss = useStore((s) => s.dismissPermission)
  const allowRef = useRef<HTMLButtonElement>(null)

  const respond = (behavior: 'allow' | 'deny', remember = false): void => {
    void window.api.permission.respond(
      request.requestId,
      behavior === 'allow'
        ? { behavior: 'allow', rememberForSession: remember }
        : { behavior: 'deny' }
    )
    dismiss(request.requestId)
  }

  // 고빈도 인터랙션이라 키보드를 지원한다: Allow 에 포커스(Enter/Space=허용), Esc=거부.
  useEffect(() => {
    allowRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        respond('deny')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // requestId 가 바뀌면(다음 권한 요청) 다시 포커스/바인딩.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId])

  const heading = request.title ?? `Allow ${request.displayName ?? request.toolName}?`
  const detail = summarizePermission(request)

  return (
    <div className="shrink-0 mx-4 mb-2 rounded-xl border border-[var(--warning-500)]/30 bg-[var(--warning-500)]/10 px-3.5 py-2.5 shadow-lg">
      <div className="flex items-start gap-2.5">
        <ShieldQuestion size={16} className="text-[var(--warning-400)] mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-neutral-100">{heading}</div>
          {detail && (
            <pre className="mt-1 text-xs text-neutral-400 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
              {detail}
            </pre>
          )}
        </div>
        {/* 보조 동작(Deny · Always allow)과 기본 동작(Allow)을 시각적으로 분리해 위계를 분명히 한다. */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => respond('deny')}
            className="text-sm px-2.5 py-1 rounded-md text-neutral-300 hover:bg-[var(--surface-2)] hover:text-neutral-100"
          >
            Deny
          </button>
          <button
            onClick={() => respond('allow', true)}
            title={`Allow ${request.displayName ?? request.toolName} for the rest of this session without asking`}
            className="text-sm px-2.5 py-1 rounded-md text-[var(--warning-300)] hover:bg-[var(--warning-500)]/15"
          >
            Always allow
          </button>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--warning-500)]/25" />
          <button
            ref={allowRef}
            onClick={() => respond('allow')}
            className="text-sm px-3 py-1 rounded-md bg-[var(--warning-500)]/90 text-black font-medium shadow-sm hover:bg-[var(--warning-400)] focus:outline-none focus:ring-2 focus:ring-[var(--warning-300)]/60"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
