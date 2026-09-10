import { useRef } from 'react'
import { useSuppressViewsOver } from '../lib/viewSuppress'
import type { HTMLAttributes } from 'react'

export const menuItemCls =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:hover:bg-transparent'

/** 헤더 드롭다운이 같은 표면·테두리·항목 밀도를 쓰도록 하는 공통 패널. */
export default function MenuPanel({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  // 드롭다운은 화면 한 귀퉁이만 덮는다 — 겹치는 뷰만 숨긴다. 이 한 줄로 StackPopover·
  // PrActionsMenu·SavedPromptPicker·BaseSyncControl 이 함께 따라온다([[lib/viewSuppress]]).
  const box = useRef<HTMLDivElement>(null)
  useSuppressViewsOver(box)
  return (
    <div
      ref={box}
      className={`rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] py-1 shadow-xl ${className}`}
      {...props}
    />
  )
}
