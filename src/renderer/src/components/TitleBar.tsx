import { Settings, BellDot } from 'lucide-react'
import { useStore } from '../store'

export default function TitleBar({
  onOpenSettings
}: {
  onOpenSettings: () => void
}): React.JSX.Element {
  const unread = useStore((s) => s.unread)
  const selectedId = useStore((s) => s.selectedWorkspaceId)
  const nextUnreadId = useStore((s) => s.nextUnreadId)
  const select = useStore((s) => s.selectWorkspace)

  const unreadCount = Object.entries(unread).filter(
    ([id, on]) => on && id !== selectedId
  ).length

  const goNextUnread = (): void => {
    const id = nextUnreadId()
    if (id) void select(id)
  }

  return (
    <div className="drag h-11 shrink-0 flex items-center justify-between bg-[#0b0c0e] border-b border-[#1c1f25] pl-20 pr-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-neutral-200">
        <span className="text-base">🎻</span>
        Ditto
        <span className="text-neutral-600 font-normal">· Claude Code orchestrator</span>
      </div>

      <div className="flex items-center gap-2">
        {unreadCount > 0 && (
          <button
            onClick={goNextUnread}
            className="no-drag flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-blue-600/90 text-white text-[12px] font-medium hover:bg-blue-500"
            title="Jump to the next session with a completed response"
          >
            <BellDot size={13} />
            Next unread ({unreadCount})
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="no-drag h-7 w-7 grid place-items-center rounded-md text-neutral-400 hover:bg-[#1c1f25] hover:text-neutral-200"
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </div>
  )
}
