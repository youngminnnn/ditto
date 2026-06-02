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
  ExternalLink,
  BellDot
} from 'lucide-react'
import { useStore } from '../store'
import { PERMISSION_LABELS, PERMISSION_ORDER } from '../lib/permission'
import { modelLabel } from '../lib/models'
import MessageList from './MessageList'
import Composer from './Composer'
import ScriptPanel from './ScriptPanel'
import PermissionPrompt from './PermissionPrompt'
import type { PermissionMode, Workspace } from '@shared/types'

export default function ChatView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const [showScripts, setShowScripts] = useState(false)
  const git = useStore((s) => s.gitStatus[workspace.id])
  const pr = useStore((s) => s.prStatus[workspace.id])
  const refreshGit = useStore((s) => s.refreshGit)
  const refreshPr = useStore((s) => s.refreshPr)
  const settingsModel = useStore((s) => s.app!.settings.model)
  const permissions = useStore((s) => s.permissions)
  const pending = permissions.find((p) => p.workspaceId === workspace.id) ?? null

  const unread = useStore((s) => s.unread)
  const nextUnreadId = useStore((s) => s.nextUnreadId)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const unreadCount = Object.entries(unread).filter(
    ([id, on]) => on && id !== workspace.id
  ).length

  const model = modelLabel(workspace.lastModel ?? settingsModel)

  const archiveWorkspace = async (): Promise<void> => {
    const ok = window.confirm(
      `Archive workspace "${workspace.name}"?\nIts worktree directory will be removed (branch & history kept). You can unarchive it later.`
    )
    if (!ok) return
    await window.api.workspace.archive(workspace.id)
    useStore.getState().selectWorkspace(null)
  }

  const setMode = (mode: PermissionMode): void => {
    void window.api.workspace.setPermissionMode(workspace.id, mode)
  }

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* 헤더 */}
      <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-[#1c1f25]">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-neutral-100 truncate">
            {workspace.name}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
            <GitBranch size={11} />
            <span className="truncate">{workspace.branch}</span>
            {git && (
              <span className="text-neutral-600">
                · {git.changedFiles} changed
                {git.ahead > 0 ? ` · ↑${git.ahead}` : ''}
              </span>
            )}
            <button
              onClick={() => {
                void refreshGit(workspace.id)
                void refreshPr(workspace.id)
              }}
              className="text-neutral-600 hover:text-neutral-300"
              title="Refresh git & PR status"
            >
              <RefreshCw size={10} />
            </button>
          </div>
        </div>

        <div className="flex-1" />

        {pr && (
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
        )}

        <span
          className="flex items-center gap-1 text-[11px] text-neutral-500 px-1.5"
          title="Model for this session"
        >
          <Cpu size={12} />
          {model}
        </span>

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

        <HeaderButton title="Scripts / terminal" onClick={() => setShowScripts((v) => !v)} active={showScripts}>
          <Terminal size={15} />
        </HeaderButton>
        <HeaderButton
          title="Open in editor"
          onClick={() => void window.api.workspace.openInEditor(workspace.id)}
        >
          <Code2 size={15} />
        </HeaderButton>
        <HeaderButton
          title="Reveal in Finder"
          onClick={() => void window.api.workspace.revealInFinder(workspace.id)}
        >
          <FolderOpen size={15} />
        </HeaderButton>
        <HeaderButton title="Archive workspace" onClick={archiveWorkspace} danger>
          <Archive size={15} />
        </HeaderButton>
      </div>

      {/* 대화 */}
      <MessageList workspaceId={workspace.id} />

      {/* 권한 프롬프트 */}
      {pending && <PermissionPrompt request={pending} />}

      {/* 입력창 바로 위, 오른쪽: 다른 세션의 완료된 미확인 응답으로 이동 */}
      {unreadCount > 0 && (
        <div className="px-4">
          <div className="max-w-3xl mx-auto flex justify-end">
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
          </div>
        </div>
      )}

      {/* 입력 */}
      <Composer workspace={workspace} />

      {/* 스크립트 패널 */}
      {showScripts && <ScriptPanel workspaceId={workspace.id} onClose={() => setShowScripts(false)} />}
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
