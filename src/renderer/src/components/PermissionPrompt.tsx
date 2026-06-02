import { ShieldQuestion } from 'lucide-react'
import { useStore } from '../store'
import type { PermissionRequest } from '@shared/types'

export default function PermissionPrompt({
  request
}: {
  request: PermissionRequest
}): React.JSX.Element {
  const dismiss = useStore((s) => s.dismissPermission)

  const respond = (behavior: 'allow' | 'deny'): void => {
    void window.api.permission.respond(
      request.requestId,
      behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny' }
    )
    dismiss(request.requestId)
  }

  const heading =
    request.title ?? `Allow ${request.displayName ?? request.toolName}?`
  const detail = summarize(request)

  return (
    <div className="shrink-0 mx-4 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
      <div className="flex items-start gap-2.5">
        <ShieldQuestion size={16} className="text-amber-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-neutral-100">{heading}</div>
          {detail && (
            <pre className="mt-1 text-[11.5px] text-neutral-400 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
              {detail}
            </pre>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => respond('deny')}
            className="text-[12px] px-2.5 py-1 rounded-md text-neutral-300 hover:bg-[#1c1f25]"
          >
            Deny
          </button>
          <button
            onClick={() => respond('allow')}
            className="text-[12px] px-2.5 py-1 rounded-md bg-amber-500/90 text-black font-medium hover:bg-amber-400"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}

function summarize(request: PermissionRequest): string {
  const input = request.input
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.command === 'string') return obj.command
    if (typeof obj.file_path === 'string') return obj.file_path
  }
  return request.decisionReason ?? ''
}
