import { Settings } from 'lucide-react'
import Logo from './Logo'

export default function TitleBar({
  onOpenSettings
}: {
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <div className="drag h-11 shrink-0 flex items-center justify-between bg-[var(--bg)] border-b border-[var(--surface-2)] pl-20 pr-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-neutral-200">
        <Logo size={18} />
        Ditto
        <span className="text-neutral-600 font-normal">· AI coding agent orchestrator</span>
      </div>
      <button
        onClick={onOpenSettings}
        className="no-drag h-7 w-7 grid place-items-center rounded-md text-neutral-400 hover:bg-[var(--surface-2)] hover:text-neutral-200"
        title="Settings"
      >
        <Settings size={16} />
      </button>
    </div>
  )
}
