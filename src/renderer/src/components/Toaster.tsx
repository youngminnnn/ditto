import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react'
import { useStore, type ToastKind } from '../store'

/** 인앱 토스트. window.alert 를 대체해 다크 테마와 일관된 비차단 알림을 띄운다. */
export default function Toaster(): React.JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2.5 rounded-lg border bg-[var(--surface)] px-3.5 py-2.5 shadow-2xl border-[var(--border)]"
        >
          <Icon kind={t.kind} />
          <span className="flex-1 text-[12.5px] text-neutral-200 whitespace-pre-wrap break-words">
            {t.message}
          </span>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 h-5 w-5 grid place-items-center rounded text-neutral-500 hover:text-neutral-200"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

function Icon({ kind }: { kind: ToastKind }): React.JSX.Element {
  if (kind === 'success') return <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
  if (kind === 'error') return <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
  return <Info size={15} className="mt-0.5 shrink-0 text-blue-400" />
}
