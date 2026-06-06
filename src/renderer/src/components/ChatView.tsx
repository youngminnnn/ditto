import { useState } from 'react'
import {
  GitBranch,
  FolderOpen,
  Code2,
  Terminal,
  Archive,
  RefreshCw,
  Cpu,
  GitPullRequest,
  GitPullRequestCreate,
  ExternalLink,
  BellDot,
  ShieldQuestion
} from 'lucide-react'
import { useStore } from '../store'
import { PERMISSION_LABELS, PERMISSION_ORDER } from '../lib/permission'
import { MODEL_OPTIONS, modelLabel } from '../lib/models'
import { formatCost } from '../lib/format'
import MessageList from './MessageList'
import Composer from './Composer'
import ScriptPanel from './ScriptPanel'
import PermissionPrompt from './PermissionPrompt'
import DiffModal from './DiffModal'
import type { ChatItem, PermissionMode, Workspace } from '@shared/types'

export default function ChatView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const showScripts = useStore((s) => s.scriptPanelOpen[workspace.id] ?? false)
  const setShowScripts = useStore((s) => s.setScriptPanelOpen)
  const [showDiff, setShowDiff] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const git = useStore((s) => s.gitStatus[workspace.id])
  const pr = useStore((s) => s.prStatus[workspace.id])
  const refreshGit = useStore((s) => s.refreshGit)
  const refreshPr = useStore((s) => s.refreshPr)
  const settingsModel = useStore((s) => s.app!.settings.model)
  const permissions = useStore((s) => s.permissions)
  const pending = permissions.find((p) => p.workspaceId === workspace.id) ?? null
  const transcript = useStore((s) => s.transcripts[workspace.id]) ?? EMPTY
  const confirm = useStore((s) => s.confirm)
  const pushToast = useStore((s) => s.pushToast)

  const unread = useStore((s) => s.unread)
  const nextUnreadId = useStore((s) => s.nextUnreadId)
  const nextPendingPermissionId = useStore((s) => s.nextPendingPermissionId)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const unreadCount = Object.entries(unread).filter(([id, on]) => on && id !== workspace.id).length
  const pendingElsewhere = permissions.filter((p) => p.workspaceId !== workspace.id)
  const pendingElsewhereCount = new Set(pendingElsewhere.map((p) => p.workspaceId)).size

  const model = modelLabel(workspace.model ?? workspace.lastModel ?? settingsModel)
  const sessionCost = transcript.reduce(
    (sum, it) => sum + (it.type === 'result' ? it.costUsd : 0),
    0
  )
  const running = workspace.status === 'running'

  const archiveWorkspace = async (): Promise<void> => {
    const ok = await confirm({
      title: `Archive "${workspace.name}"?`,
      body: 'Its worktree directory will be removed (branch & history kept). You can unarchive it later.',
      confirmLabel: 'Archive',
      danger: true
    })
    if (!ok) return
    await window.api.workspace.archive(workspace.id)
    void selectWorkspace(null)
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await Promise.all([refreshGit(workspace.id), refreshPr(workspace.id)])
    setRefreshing(false)
  }

  const createPr = async (): Promise<void> => {
    const res = await window.api.pr.create(workspace.id)
    if (res.error) pushToast('error', `Couldn't open PR page: ${res.error}`)
    else {
      pushToast('info', 'Opening the PR creation page in your browser…')
      setTimeout(() => void refreshPr(workspace.id), 4000)
    }
  }

  const setMode = (mode: PermissionMode): void => {
    void window.api.workspace.setPermissionMode(workspace.id, mode)
  }

  const setModel = (value: string): void => {
    void window.api.workspace.setModel(workspace.id, value || null)
  }

  const commitName = (): void => {
    const name = (editingName ?? '').trim()
    if (name && name !== workspace.name) void window.api.workspace.rename(workspace.id, name)
    setEditingName(null)
  }

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* 헤더 */}
      <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-[#1c1f25]">
        <div className="min-w-0">
          {editingName !== null ? (
            <input
              autoFocus
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
                else if (e.key === 'Escape') setEditingName(null)
              }}
              className="text-[13px] font-semibold text-neutral-100 bg-[#15171c] border border-[#384050] rounded px-1.5 py-0.5 outline-none"
            />
          ) : (
            <div
              className="text-[13px] font-semibold text-neutral-100 truncate cursor-text"
              title={pr?.title ? `${pr.title}\n(double-click to rename “${workspace.name}”)` : 'Double-click to rename'}
              onDoubleClick={() => setEditingName(workspace.name)}
            >
              {pr?.title || workspace.name}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            <GitBranch size={11} />
            <span className="truncate">{workspace.branch}</span>
            {git && (
              <button
                onClick={() => setShowDiff(true)}
                disabled={git.changedFiles === 0}
                className="text-neutral-500 hover:text-neutral-200 disabled:hover:text-neutral-500 disabled:cursor-default"
                title={git.changedFiles > 0 ? 'View changes' : 'No changes'}
              >
                · {git.changedFiles} changed{git.ahead > 0 ? ` · ↑${git.ahead}` : ''}
                {git.behind > 0 ? ` · ↓${git.behind}` : ''}
              </button>
            )}
            <button
              onClick={refresh}
              className="text-neutral-600 hover:text-neutral-300"
              title="Refresh git & PR status"
            >
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            </button>
            {sessionCost > 0 && (
              <span className="text-neutral-600" title="Total cost this session">
                · {formatCost(sessionCost)}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1" />

        {pr ? (
          <button
            onClick={() => void window.api.openExternal(pr.url)}
            className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-[#15171c] border border-[#23262d] text-neutral-300 hover:border-[#384050]"
            title="Open pull request in browser"
          >
            <GitPullRequest size={12} className="text-violet-400" />
            <span className="text-neutral-400">#{pr.number}</span>
            <span>{pr.label}</span>
            <ExternalLink size={10} className="text-neutral-500" />
          </button>
        ) : (
          git &&
          git.ahead > 0 && (
            <button
              onClick={createPr}
              className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-[#15171c] border border-[#23262d] text-neutral-300 hover:border-[#384050]"
              title="Open a pull request for this branch"
            >
              <GitPullRequestCreate size={12} className="text-violet-400" />
              Create PR
            </button>
          )
        )}

        <span className="flex items-center gap-1 text-[11px] text-neutral-500 pl-1" title="Model for new turns">
          <Cpu size={12} />
        </span>
        <select
          value={workspace.model ?? ''}
          onChange={(e) => setModel(e.target.value)}
          disabled={running}
          className="no-drag text-[11.5px] bg-[#15171c] border border-[#23262d] rounded-md px-1.5 py-1 text-neutral-300 focus:outline-none focus:border-[#384050] disabled:opacity-50"
          title={running ? 'Stop the current turn to change model' : 'Model for this workspace'}
        >
          <option value="">Default · {modelLabel(settingsModel)}</option>
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          {workspace.model && !MODEL_OPTIONS.some((m) => m.id === workspace.model) && (
            <option value={workspace.model}>{model}</option>
          )}
        </select>

        <select
          value={workspace.permissionMode}
          onChange={(e) => setMode(e.target.value as PermissionMode)}
          className="no-drag text-[11.5px] bg-[#15171c] border border-[#23262d] rounded-md px-2 py-1 text-neutral-300 focus:outline-none focus:border-[#384050]"
          title="Permission mode — ⇧⇥ to cycle"
        >
          {PERMISSION_ORDER.map((mode) => (
            <option key={mode} value={mode}>
              {PERMISSION_LABELS[mode]}
            </option>
          ))}
        </select>

        <HeaderButton title="Scripts" onClick={() => setShowScripts(workspace.id, !showScripts)} active={showScripts}>
          <Terminal size={15} />
        </HeaderButton>
        <HeaderButton title="Open in editor" onClick={() => void window.api.workspace.openInEditor(workspace.id)}>
          <Code2 size={15} />
        </HeaderButton>
        <HeaderButton title="Reveal in Finder" onClick={() => void window.api.workspace.revealInFinder(workspace.id)}>
          <FolderOpen size={15} />
        </HeaderButton>
        <HeaderButton title="Archive workspace" onClick={archiveWorkspace} danger>
          <Archive size={15} />
        </HeaderButton>
      </div>

      {/* 대화 */}
      <MessageList workspaceId={workspace.id} running={running} />

      {/* 권한 프롬프트 */}
      {pending && <PermissionPrompt request={pending} />}

      {/* 입력창 바로 위: 다른 세션으로 점프(권한 대기 우선, 그다음 미확인 응답) */}
      {(pendingElsewhereCount > 0 || unreadCount > 0) && (
        <div className="px-4">
          <div className="max-w-3xl mx-auto flex justify-end gap-2">
            {pendingElsewhereCount > 0 && (
              <button
                onClick={() => {
                  const id = nextPendingPermissionId()
                  if (id) void selectWorkspace(id)
                }}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-amber-500/90 text-black text-[11.5px] font-medium hover:bg-amber-400 shadow-lg"
                title="Jump to a session waiting for permission"
              >
                <ShieldQuestion size={13} />
                Needs input ({pendingElsewhereCount})
              </button>
            )}
            {unreadCount > 0 && (
              <button
                onClick={() => {
                  const id = nextUnreadId()
                  if (id) void selectWorkspace(id)
                }}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-blue-600/90 text-white text-[11.5px] font-medium hover:bg-blue-500 shadow-lg"
                title="Jump to the next session with a completed response"
              >
                <BellDot size={13} />
                Next unread ({unreadCount})
              </button>
            )}
          </div>
        </div>
      )}

      {/* 입력 */}
      <Composer workspace={workspace} />

      {/* 스크립트 패널 */}
      {showScripts && <ScriptPanel workspaceId={workspace.id} onClose={() => setShowScripts(workspace.id, false)} />}

      {showDiff && (
        <DiffModal workspaceId={workspace.id} baseBranch={workspace.baseBranch} onClose={() => setShowDiff(false)} />
      )}
    </div>
  )
}

function HeaderButton({
  children,
  onClick,
  title,
  active,
  danger
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        'no-drag h-7 w-7 grid place-items-center rounded-md ' +
        (danger
          ? 'text-neutral-400 hover:bg-red-500/15 hover:text-red-400'
          : active
            ? 'bg-[#1c1f25] text-neutral-100'
            : 'text-neutral-400 hover:bg-[#1c1f25] hover:text-neutral-100')
      }
    >
      {children}
    </button>
  )
}

const EMPTY: ChatItem[] = []
