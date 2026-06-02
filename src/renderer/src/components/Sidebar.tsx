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
  ChevronRight
} from 'lucide-react'
import { useStore } from '../store'
import type { Workspace } from '@shared/types'

export default function Sidebar({
  onNewWorkspace,
  onConfigRepo
}: {
  onNewWorkspace: (repoId: string) => void
  onConfigRepo: (repoId: string) => void
}): React.JSX.Element {
  const app = useStore((s) => s.app)!

  const addRepo = async (): Promise<void> => {
    const res = await window.api.repo.add()
    if (res.error) window.alert(res.error)
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
          <p className="px-3 py-8 text-xs text-neutral-600 text-center leading-relaxed">
            No repositories yet.
            <br />
            Use the + button above to add a git repo.
          </p>
        )}

        {app.repos.map((repo) => {
          const all = app.workspaces.filter((w) => w.repoId === repo.id)
          const active = all.filter((w) => !w.archived)
          const archived = all.filter((w) => w.archived)
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
                <button
                  onClick={() => onConfigRepo(repo.id)}
                  className="opacity-0 group-hover:opacity-100 h-5 w-5 grid place-items-center rounded text-neutral-500 hover:bg-[#1c1f25] hover:text-neutral-200"
                  title="Repository settings (setup/dev scripts)"
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
                {active.length === 0 && (
                  <p className="px-3 py-1 text-[11px] text-neutral-600">No workspaces</p>
                )}
                {active.map((ws) => (
                  <WorkspaceRow key={ws.id} workspace={ws} />
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

function WorkspaceRow({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const selectedId = useStore((s) => s.selectedWorkspaceId)
  const select = useStore((s) => s.selectWorkspace)
  const git = useStore((s) => s.gitStatus[workspace.id])

  const active = workspace.id === selectedId

  const archive = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const ok = window.confirm(
      `Archive "${workspace.name}"?\nIts worktree directory will be removed (branch & history kept). You can unarchive it later.`
    )
    if (!ok) return
    await window.api.workspace.archive(workspace.id)
    if (active) void select(null)
  }

  return (
    <div
      onClick={() => void select(workspace.id)}
      className={
        'group/ws w-full flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-md text-left cursor-pointer ' +
        (active ? 'bg-[#1b1f27]' : 'hover:bg-[#15171c]')
      }
    >
      <StatusDot status={workspace.status} />
      <div className="flex-1 min-w-0">
        <div
          className={
            'truncate text-[12.5px] ' + (active ? 'text-neutral-100' : 'text-neutral-300')
          }
        >
          {workspace.name}
        </div>
        <div className="flex items-center gap-1 text-[10.5px] text-neutral-600 truncate">
          <GitBranch size={10} className="shrink-0" />
          <span className="truncate">{workspace.branch}</span>
          {git && git.changedFiles > 0 && (
            <span className="text-amber-500/80 shrink-0">·{git.changedFiles}</span>
          )}
        </div>
      </div>
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

  const unarchive = async (): Promise<void> => {
    const res = await window.api.workspace.unarchive(workspace.id)
    if (res.error) window.alert(res.error)
    else void select(workspace.id)
  }

  const remove = async (): Promise<void> => {
    const ok = window.confirm(
      `Permanently delete "${workspace.name}"? This removes its history and cannot be undone. (The branch is kept.)`
    )
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

function StatusDot({ status }: { status: Workspace['status'] }): React.JSX.Element {
  if (status === 'running') {
    return <Loader2 size={13} className="text-blue-400 animate-spin shrink-0" />
  }
  const color = status === 'error' ? 'bg-red-500' : 'bg-neutral-600'
  return <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
}
