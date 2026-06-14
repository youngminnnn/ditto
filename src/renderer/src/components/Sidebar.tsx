import { useState } from 'react'
import {
  FolderGit2,
  Plus,
  Settings2,
  GitBranch,
  Loader2,
  Archive,
  ArchiveRestore,
  Trash2,
  ChevronRight,
  ShieldQuestion
} from 'lucide-react'
import { useStore } from '../store'
import { useNow } from '../lib/useNow'
import { formatDuration } from '../lib/format'
import type { Workspace } from '@shared/types'

export default function Sidebar({
  onNewWorkspace,
  onConfigRepo
}: {
  onNewWorkspace: (repoId: string) => void
  onConfigRepo: (repoId: string) => void
}): React.JSX.Element {
  const app = useStore((s) => s.app)!
  const pending = useStore((s) => s.pending)
  const pushToast = useStore((s) => s.pushToast)

  // 실행 중인 세션이 하나라도 있으면 1초마다 갱신해 경과 시간을 흐르게 한다.
  const anyRunning = app.workspaces.some((w) => !w.archived && w.status === 'running')
  const now = useNow(1000, anyRunning)

  // ⌘1–9 단축키(App.tsx)는 archived 제외 전체 워크스페이스의 평탄한 순서에 매핑된다.
  // 같은 순서로 앞 9개에 번호를 매겨 사이드바 행에 배지로 노출, 화면-키맵 불일치를 없앤다.
  const shortcutById = new Map<string, number>()
  app.workspaces
    .filter((w) => !w.archived)
    .slice(0, 9)
    .forEach((w, i) => shortcutById.set(w.id, i + 1))

  const addRepo = async (): Promise<void> => {
    const res = await window.api.repo.add()
    if (res.error) pushToast('error', res.error)
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-[#0d0e11]">
      <div className="flex items-center justify-between px-3 h-10 shrink-0">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">
          Repositories
        </span>
        <button
          onClick={addRepo}
          className="h-6 w-6 grid place-items-center rounded-md text-neutral-400 hover:bg-[#1c1f25] hover:text-neutral-100"
          title="Add repository"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {app.repos.length === 0 && (
          <p className="px-3 py-8 text-xs text-neutral-500 text-center leading-relaxed">
            No repositories yet.
            <br />
            Use the + button above to add a git repo.
          </p>
        )}

        {app.repos.map((repo) => {
          const all = app.workspaces.filter((w) => w.repoId === repo.id)
          const active = all.filter((w) => !w.archived)
          const archived = all.filter((w) => w.archived)
          const repoPending = pending.filter((p) => p.repoId === repo.id)
          const runningCount = active.filter((w) => w.status === 'running').length
          return (
            <div key={repo.id} className="mb-3">
              <div className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md">
                <FolderGit2 size={14} className="text-neutral-500 shrink-0" />
                <span
                  className="flex-1 truncate text-[12.5px] font-medium text-neutral-300"
                  title={repo.path}
                >
                  {repo.name}
                </span>
                {runningCount > 0 && (
                  <span
                    className="flex items-center gap-1 text-[10px] text-blue-400/80 shrink-0"
                    title={`${runningCount} running`}
                  >
                    <Loader2 size={10} className="animate-spin" />
                    {runningCount}
                  </span>
                )}
                <button
                  onClick={() => onConfigRepo(repo.id)}
                  className="h-5 w-5 grid place-items-center rounded text-neutral-500 hover:bg-[#1c1f25] hover:text-neutral-200"
                  title="Repository settings (setup / dev / archive scripts)"
                >
                  <Settings2 size={13} />
                </button>
                <button
                  onClick={() => onNewWorkspace(repo.id)}
                  className="h-5 w-5 grid place-items-center rounded text-neutral-400 hover:bg-[#1c1f25] hover:text-neutral-100"
                  title="New workspace"
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="mt-0.5 space-y-0.5">
                {active.length === 0 && repoPending.length === 0 && (
                  <p className="px-3 py-1 text-[11px] text-neutral-600">No workspaces</p>
                )}
                {active.map((ws) => (
                  <WorkspaceRow
                    key={ws.id}
                    workspace={ws}
                    shortcut={shortcutById.get(ws.id)}
                    now={now}
                  />
                ))}
                {repoPending.map((p) => (
                  <PendingRow key={p.id} name={p.name} />
                ))}
              </div>

              {archived.length > 0 && <ArchivedSection workspaces={archived} />}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function WorkspaceRow({
  workspace,
  shortcut,
  now
}: {
  workspace: Workspace
  shortcut?: number
  now: number
}): React.JSX.Element {
  const selectedId = useStore((s) => s.selectedWorkspaceId)
  const select = useStore((s) => s.selectWorkspace)
  const git = useStore((s) => s.gitStatus[workspace.id])
  const pr = useStore((s) => s.prStatus[workspace.id])
  const unread = useStore((s) => s.unread[workspace.id])
  const runningSince = useStore((s) => s.runningSince[workspace.id])
  const confirm = useStore((s) => s.confirm)
  const awaitingPermission = useStore((s) =>
    s.permissions.some((p) => p.workspaceId === workspace.id)
  )

  const active = workspace.id === selectedId
  // PR 이 있으면 표시 이름을 PR 제목으로(없으면 workspace 이름). PR 제목이 바뀌면 자동 반영된다.
  const displayName = pr?.title || workspace.name

  const archive = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const ok = await confirm({
      title: `Archive "${workspace.name}"?`,
      body: 'Its worktree directory will be removed (branch & history kept). You can unarchive it later.',
      confirmLabel: 'Archive',
      danger: true
    })
    if (!ok) return
    await window.api.workspace.archive(workspace.id)
    if (active) void select(null)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void select(workspace.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void select(workspace.id)
        }
      }}
      className={
        'group/ws w-full flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-md text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#384050] ' +
        (active ? 'bg-[#1b1f27]' : 'hover:bg-[#15171c]')
      }
    >
      <StatusDot status={workspace.status} awaitingPermission={awaitingPermission} />
      <div className="flex-1 min-w-0">
        <div
          className={'truncate text-[12.5px] ' + (active ? 'text-neutral-100' : 'text-neutral-300')}
          title={displayName}
        >
          {displayName}
        </div>
        <div className="flex items-center gap-1 text-[10.5px] text-neutral-500 truncate">
          <GitBranch size={10} className="shrink-0" />
          <span className="truncate">{workspace.branch}</span>
          {git && git.changedFiles > 0 && (
            <span className="text-amber-500/80 shrink-0">·{git.changedFiles}</span>
          )}
          {workspace.status === 'running' && runningSince && (
            <span
              className="text-blue-400/80 shrink-0 tabular-nums"
              title="Running time of the current turn"
            >
              · {formatDuration(now - runningSince)}
            </span>
          )}
        </div>
      </div>
      {shortcut !== undefined && (
        <kbd
          className="shrink-0 text-[9.5px] leading-none font-medium text-neutral-600 group-hover/ws:hidden tabular-nums"
          title={`Switch with ⌘${shortcut}`}
        >
          ⌘{shortcut}
        </kbd>
      )}
      {awaitingPermission && !active && (
        <span className="text-amber-400 shrink-0 group-hover/ws:hidden" title="Waiting for your permission">
          <ShieldQuestion size={13} />
        </span>
      )}
      {unread && !active && !awaitingPermission && (
        <span
          className="h-2 w-2 rounded-full bg-blue-500 shrink-0 group-hover/ws:hidden"
          title="Completed response — unread"
        />
      )}
      <button
        onClick={archive}
        className="opacity-0 group-hover/ws:opacity-100 h-5 w-5 grid place-items-center rounded text-neutral-500 hover:bg-[#1c1f25] hover:text-neutral-200 shrink-0"
        title="Archive workspace"
      >
        <Archive size={13} />
      </button>
    </div>
  )
}

/** worktree 생성이 끝날 때까지 보여주는 비활성 자리표시 행. 완료되면 실제 WorkspaceRow 로 교체된다. */
function PendingRow({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="w-full flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-md text-left opacity-70 select-none">
      <Loader2 size={13} className="text-blue-400 animate-spin shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-[12.5px] text-neutral-300">{name || 'Creating…'}</div>
        <div className="text-[10.5px] text-neutral-500 truncate">Setting up worktree…</div>
      </div>
    </div>
  )
}

function ArchivedSection({ workspaces }: { workspaces: Workspace[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 text-[10.5px] text-neutral-600 hover:text-neutral-400"
      >
        <ChevronRight size={11} className={open ? 'rotate-90 transition' : 'transition'} />
        Archived ({workspaces.length})
      </button>
      {open && (
        <div className="space-y-0.5">
          {workspaces.map((ws) => (
            <ArchivedRow key={ws.id} workspace={ws} />
          ))}
        </div>
      )}
    </div>
  )
}

function ArchivedRow({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const select = useStore((s) => s.selectWorkspace)
  const confirm = useStore((s) => s.confirm)
  const pushToast = useStore((s) => s.pushToast)

  const unarchive = async (): Promise<void> => {
    const res = await window.api.workspace.unarchive(workspace.id)
    if (res.error) pushToast('error', res.error)
    else void select(workspace.id)
  }

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: `Permanently delete "${workspace.name}"?`,
      body: 'This removes its history and cannot be undone. (The branch is kept.)',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    await window.api.workspace.remove(workspace.id, false)
  }

  return (
    <div className="group/arc flex items-center gap-2 pl-6 pr-1.5 py-1 rounded-md hover:bg-[#15171c]">
      <span className="flex-1 truncate text-[11.5px] text-neutral-500" title={workspace.branch}>
        {workspace.name}
      </span>
      <button
        onClick={unarchive}
        className="opacity-0 group-hover/arc:opacity-100 h-5 w-5 grid place-items-center rounded text-neutral-500 hover:bg-[#1c1f25] hover:text-neutral-200"
        title="Unarchive (recreate worktree)"
      >
        <ArchiveRestore size={12} />
      </button>
      <button
        onClick={remove}
        className="opacity-0 group-hover/arc:opacity-100 h-5 w-5 grid place-items-center rounded text-neutral-500 hover:bg-red-500/15 hover:text-red-400"
        title="Delete permanently"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function StatusDot({
  status,
  awaitingPermission
}: {
  status: Workspace['status']
  awaitingPermission: boolean
}): React.JSX.Element {
  if (awaitingPermission) {
    return <ShieldQuestion size={13} className="text-amber-400 shrink-0" />
  }
  if (status === 'running') {
    return <Loader2 size={13} className="text-blue-400 animate-spin shrink-0" />
  }
  const color = status === 'error' ? 'bg-red-500' : 'bg-neutral-600'
  return <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
}
