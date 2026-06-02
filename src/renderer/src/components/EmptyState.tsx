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
            ? '왼쪽 리포지토리 옆 + 버튼으로 새 workspace 를 만드세요. 각 workspace 는 격리된 git worktree 에서 독립된 Claude Code 세션으로 실행됩니다.'
            : '시작하려면 왼쪽 상단 + 버튼으로 git 리포지토리를 추가하세요.'}
        </p>
      </div>
    </div>
  )
}
