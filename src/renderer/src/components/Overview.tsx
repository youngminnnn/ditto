import { useMemo, useState } from 'react'
import { GitBranch, Loader2, ShieldQuestion, GitPullRequest, Square } from 'lucide-react'
import { useStore } from '../store'
import { useNow } from '../lib/useNow'
import { formatDuration } from '../lib/format'
import { workspaceDisplayName } from '@shared/types'
import type { Workspace } from '@shared/types'

type FilterKey = 'all' | 'running' | 'attention' | 'unread' | 'idle'

/**
 * 워크스페이스를 선택하지 않았을 때 보이는 전역 현황 보드.
 * 모든 활성 세션의 상태(실행/권한대기/미확인/유휴)를 한 화면에서 보고,
 * 상태별로 필터링하거나 카드를 눌러 바로 진입한다.
 */
export default function Overview(): React.JSX.Element {
  const app = useStore((s) => s.app)!
  const unread = useStore((s) => s.unread)
  const permissions = useStore((s) => s.permissions)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const stopAll = useStore((s) => s.stopAll)
  const confirm = useStore((s) => s.confirm)
  const [filter, setFilter] = useState<FilterKey>('all')

  const active = useMemo(() => app.workspaces.filter((w) => !w.archived), [app.workspaces])
  const anyRunning = active.some((w) => w.status === 'running')
  const now = useNow(1000, anyRunning)

  const pendingIds = new Set(permissions.map((p) => p.workspaceId))

  const flagsOf = (
    w: Workspace
  ): { running: boolean; attention: boolean; unread: boolean; idle: boolean } => {
    const running = w.status === 'running'
    const attention = pendingIds.has(w.id)
    const isUnread = !!unread[w.id]
    return { running, attention, unread: isUnread, idle: !running && !attention && !isUnread }
  }

  const counts = {
    all: active.length,
    running: active.filter((w) => flagsOf(w).running).length,
    attention: active.filter((w) => flagsOf(w).attention).length,
    unread: active.filter((w) => flagsOf(w).unread).length,
    idle: active.filter((w) => flagsOf(w).idle).length
  }

  const shown = active.filter((w) => (filter === 'all' ? true : flagsOf(w)[filter]))

  const repoName = (repoId: string): string =>
    app.repos.find((r) => r.id === repoId)?.name ?? 'repo'

  const onStopAll = async (): Promise<void> => {
    const ok = await confirm({
      title: `Stop all ${counts.running} running session${counts.running > 1 ? 's' : ''}?`,
      body: 'Interrupts the current turn in every running workspace.',
      confirmLabel: 'Stop all',
      danger: true
    })
    if (ok) void stopAll()
  }

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'running', label: 'Running', count: counts.running },
    { key: 'attention', label: 'Needs input', count: counts.attention },
    { key: 'unread', label: 'Unread', count: counts.unread },
    { key: 'idle', label: 'Idle', count: counts.idle }
  ]

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-center gap-3 mb-5">
          <h2 className="text-[15px] font-semibold text-neutral-100">Overview</h2>
          <span className="text-[12px] text-neutral-500">
            {counts.all} workspace{counts.all === 1 ? '' : 's'}
            {counts.running > 0 && <span className="text-blue-400"> · {counts.running} running</span>}
          </span>
          {counts.running > 0 && (
            <button
              onClick={onStopAll}
              className="ml-auto flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] text-red-300 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20"
              title="Stop the current turn in every running session"
            >
              <Square size={11} fill="currentColor" />
              Stop all
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={
                'flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11.5px] border ' +
                (filter === f.key
                  ? 'bg-[var(--surface-3)] border-[var(--border-strong)] text-neutral-100'
                  : 'bg-transparent border-[var(--border)] text-neutral-400 hover:border-[var(--border-strong)]')
              }
            >
              {f.label}
              <span className="text-neutral-500 tabular-nums">{f.count}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="text-[12.5px] text-neutral-500 py-12 text-center">
            No workspaces match this filter.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {shown.map((w) => (
              <OverviewCard
                key={w.id}
                workspace={w}
                repoName={repoName(w.repoId)}
                flags={flagsOf(w)}
                now={now}
                onOpen={() => void selectWorkspace(w.id)}
              />
            ))}
          </div>
        )}

        <p className="mt-6 text-[11px] text-neutral-600 text-center">
          ⌘1–9 to switch · ⌘[ / ⌘] to cycle
        </p>
      </div>
    </div>
  )
}

function OverviewCard({
  workspace,
  repoName,
  flags,
  now,
  onOpen
}: {
  workspace: Workspace
  repoName: string
  flags: { running: boolean; attention: boolean; unread: boolean; idle: boolean }
  now: number
  onOpen: () => void
}): React.JSX.Element {
  const git = useStore((s) => s.gitStatus[workspace.id])
  const pr = useStore((s) => s.prStatus[workspace.id])
  const runningSince = useStore((s) => s.runningSince[workspace.id])

  const displayName = workspaceDisplayName(workspace, pr?.title)

  return (
    <button
      onClick={onOpen}
      className={
        'text-left rounded-xl border bg-[var(--bg-2)] p-3 transition-all duration-150 hover:border-[var(--border-strong)] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:shadow-none ' +
        (flags.attention
          ? 'border-amber-500/40'
          : flags.running
            ? 'border-blue-500/30'
            : workspace.status === 'error'
              ? 'border-red-500/30'
              : 'border-[var(--surface-2)]')
      }
    >
      <div className="flex items-center gap-2">
        <StatusDot workspace={workspace} attention={flags.attention} />
        <span className="flex-1 min-w-0 truncate text-[12.5px] text-neutral-100" title={displayName}>
          {displayName}
        </span>
        {flags.attention && <ShieldQuestion size={13} className="text-amber-400 shrink-0" />}
        {flags.unread && !flags.attention && (
          <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" title="Unread response" />
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-neutral-500 min-w-0">
        <span className="truncate text-neutral-600">{repoName}</span>
        <GitBranch size={10} className="shrink-0" />
        <span className="truncate">{workspace.branch}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-[10.5px]">
        {flags.running && runningSince ? (
          <span className="flex items-center gap-1 text-blue-400 tabular-nums">
            <Loader2 size={10} className="animate-spin" />
            {formatDuration(now - runningSince)}
          </span>
        ) : (
          <span className="text-neutral-600">{workspace.status}</span>
        )}
        {git && git.changedFiles > 0 && (
          <span className="text-amber-500/80" title="Changed files">
            {git.changedFiles} changed
          </span>
        )}
        {pr && (
          <span className="flex items-center gap-1 text-violet-300/80 ml-auto truncate" title={pr.label}>
            <GitPullRequest size={10} className="shrink-0" />
            <span className="truncate">{pr.label}</span>
          </span>
        )}
      </div>
    </button>
  )
}

function StatusDot({
  workspace,
  attention
}: {
  workspace: Workspace
  attention: boolean
}): React.JSX.Element {
  if (attention) return <ShieldQuestion size={13} className="text-amber-400 shrink-0" />
  if (workspace.status === 'running')
    return <Loader2 size={13} className="text-blue-400 animate-spin shrink-0" />
  const color = workspace.status === 'error' ? 'bg-red-500' : 'bg-neutral-600'
  return <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
}
