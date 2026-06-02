import { useStore } from '../store'

export default function EmptyState(): React.JSX.Element {
  const app = useStore((s) => s.app)!
  const hasRepo = app.repos.length > 0

  return (
    <div className="h-full grid place-items-center text-center px-8">
      <div className="max-w-sm">
        <div className="text-5xl mb-4">🎻</div>
        <h2 className="text-lg font-semibold text-neutral-200 mb-2">Ditto</h2>
        <p className="text-sm text-neutral-500 leading-relaxed">
          {hasRepo
            ? 'Create a workspace with the + button next to a repository. Each workspace runs an independent Claude Code session in its own isolated git worktree.'
            : 'To get started, add a git repository with the + button in the top-left.'}
        </p>
      </div>
    </div>
  )
}
