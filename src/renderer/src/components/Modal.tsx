import { useEffect } from 'react'
import { X } from 'lucide-react'

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
      if (e.key === 'Escape') onClose()
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
        className="no-drag bg-[#15171c] border border-[#23262d] rounded-xl shadow-2xl max-w-[92vw]"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-[#23262d]">
          <h3 className="text-[13px] font-semibold text-neutral-100">{title}</h3>
          <button
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded-md text-neutral-400 hover:bg-[#1c1f25] hover:text-neutral-100"
          >
            <X size={15} />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#23262d]">{footer}</div>
        )}
      </div>
    </div>
  )
}

export const inputClass =
  'w-full bg-[#0d0e11] border border-[#23262d] rounded-lg px-3 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-[#384050]'

export const labelClass = 'block text-[11.5px] font-medium text-neutral-400 mb-1.5'

export const primaryBtn =
  'text-[12.5px] px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:bg-[#23262d] disabled:text-neutral-600'

export const ghostBtn =
  'text-[12.5px] px-3.5 py-1.5 rounded-lg text-neutral-300 hover:bg-[#1c1f25]'
