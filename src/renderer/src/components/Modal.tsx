import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'

export default function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 위에 confirm 대화상자가 떠 있으면 Escape 는 그쪽이 처리한다(하위 모달까지 닫히지 않게).
      if (e.key === 'Escape' && !useStore.getState().confirmState) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="no-drag bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl max-w-[92vw] max-h-[88vh] flex flex-col"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-[var(--border)]">
          <h3 className="text-[13px] font-semibold text-neutral-100">{title}</h3>
          <button
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded-md text-neutral-400 hover:bg-[var(--surface-2)] hover:text-neutral-100"
          >
            <X size={15} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
        {footer && (
          <div className="shrink-0 flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export const inputClass =
  'w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-[var(--border-strong)]'

export const labelClass = 'block text-[11.5px] font-medium text-neutral-400 mb-1.5'

export const primaryBtn =
  'text-[12.5px] px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:bg-[var(--border)] disabled:text-neutral-600'

export const ghostBtn =
  'text-[12.5px] px-3.5 py-1.5 rounded-lg text-neutral-300 hover:bg-[var(--surface-2)]'
