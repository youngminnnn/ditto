import { useStore } from '../store'
import Logo from './Logo'

export default function EmptyState(): React.JSX.Element {
  const app = useStore((s) => s.app)!
  const hasRepo = app.repos.length > 0
  const active = app.workspaces.filter((w) => !w.archived)
  const running = active.filter((w) => w.status === 'running').length

  return (
    <div className="h-full w-full grid place-items-center text-center px-8">
      <div className="max-w-sm">
        <div className="mb-4 flex justify-center">
          <Logo size={56} />
        </div>
        <h2 className="text-lg font-semibold text-neutral-200 mb-2">Ditto</h2>
        <p className="text-sm text-neutral-400 leading-relaxed">
          {hasRepo
            ? 'Create a workspace with the + button next to a repository. Each workspace runs an independent AI coding agent session in its own isolated git worktree.'
            : 'To get started, add a git repository with the + button in the top-left.'}
        </p>
        {hasRepo && active.length > 0 && (
          <p className="mt-4 text-[12px] text-neutral-500">
            {active.length} workspace{active.length > 1 ? 's' : ''}
            {running > 0 && <span className="text-blue-400"> · {running} running</span>}
            <br />
            <span className="text-neutral-600">⌘1–9 to switch · ⌘[ / ⌘] to cycle</span>
          </p>
        )}
      </div>
    </div>
  )
}
