import { useState } from 'react'
import {
  GitBranch,
  FolderOpen,
  Code2,
  Terminal,
  Archive,
  RefreshCw,
  Cpu,
  Gauge,
  GitPullRequest,
  GitPullRequestCreate,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
  GitMergeConflict,
  CircleCheck,
  MessageSquareWarning,
  Clock,
  ExternalLink,
  BellDot,
  ShieldQuestion,
  PanelRight,
  type LucideIcon
} from 'lucide-react'
import { useStore } from '../store'
import { MODEL_OPTIONS, modelLabel } from '../lib/models'
import { EFFORT_OPTIONS, effortLabel } from '../lib/effort'
import { formatCost } from '../lib/format'
import MessageList from './MessageList'
import Composer from './Composer'
import ScriptPanel from './ScriptPanel'
import PermissionPrompt from './PermissionPrompt'
import QuestionPrompt from './QuestionPrompt'
import DiffModal from './DiffModal'
import { workspaceDisplayName } from '@shared/types'
import type { ChatItem, EffortSetting, PrState, Workspace } from '@shared/types'

/**
 * PR 상태별 아이콘 + 색. Tailwind v4 는 동적으로 조합한 클래스명을 스캔하지 못하므로
 * 상태마다 전체 클래스 문자열을 그대로 둔다(보간 금지).
 */
const PR_STYLE: Record<PrState, { Icon: LucideIcon; iconClass: string; badgeClass: string }> = {
  draft: {
    Icon: GitPullRequestDraft,
    iconClass: 'text-neutral-400',
    badgeClass: 'border-[var(--border-2)] bg-[var(--surface)] text-neutral-300 hover:border-neutral-500'
  },
  review_required: {
    Icon: Clock,
    iconClass: 'text-[var(--warning-400)]',
    badgeClass: 'border-[var(--warning-500)]/30 bg-[var(--warning-500)]/10 text-[var(--warning-200)] hover:border-[var(--warning-500)]/60'
  },
  changes_requested: {
    Icon: MessageSquareWarning,
    iconClass: 'text-orange-400',
    badgeClass: 'border-orange-500/30 bg-orange-500/10 text-orange-200 hover:border-orange-500/60'
  },
  approved: {
    Icon: CircleCheck,
    iconClass: 'text-[var(--success-400)]',
    badgeClass: 'border-[var(--success-500)]/30 bg-[var(--success-500)]/10 text-[var(--success-200)] hover:border-[var(--success-500)]/60'
  },
  conflict: {
    Icon: GitMergeConflict,
    iconClass: 'text-[var(--danger-400)]',
    badgeClass: 'border-[var(--danger-500)]/30 bg-[var(--danger-500)]/10 text-[var(--danger-200)] hover:border-[var(--danger-500)]/60'
  },
  open: {
    Icon: GitPullRequest,
    iconClass: 'text-[var(--accent-400)]',
    badgeClass: 'border-[var(--accent-500)]/30 bg-[var(--accent-500)]/10 text-[var(--accent-200)] hover:border-[var(--accent-500)]/60'
  },
  merged: {
    Icon: GitMerge,
    iconClass: 'text-purple-400',
    badgeClass: 'border-purple-500/30 bg-purple-500/10 text-purple-200 hover:border-purple-500/60'
  },
  closed: {
    Icon: GitPullRequestClosed,
    iconClass: 'text-neutral-500',
    badgeClass: 'border-[var(--border-2)] bg-[var(--surface)] text-neutral-400 hover:border-neutral-500'
  }
}

export default function ChatView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const showScripts = useStore((s) => s.scriptPanelOpen[workspace.id] ?? false)
  const setShowScripts = useStore((s) => s.setScriptPanelOpen)
  const rightPanelOpen = useStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useStore((s) => s.toggleRightPanel)
  const [showDiff, setShowDiff] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const git = useStore((s) => s.gitStatus[workspace.id])
  const pr = useStore((s) => s.prStatus[workspace.id])
  const refreshGit = useStore((s) => s.refreshGit)
  const refreshPr = useStore((s) => s.refreshPr)
  const settingsModel = useStore((s) => s.app!.settings.model)
  const settingsEffort = useStore((s) => s.app!.settings.effort)
  const permissions = useStore((s) => s.permissions)
  const pending = permissions.find((p) => p.workspaceId === workspace.id) ?? null
  const transcript = useStore((s) => s.transcripts[workspace.id]) ?? EMPTY
  const confirm = useStore((s) => s.confirm)
  const pushToast = useStore((s) => s.pushToast)

  const unread = useStore((s) => s.unread)
  const nextUnreadId = useStore((s) => s.nextUnreadId)
  const nextPendingPermissionId = useStore((s) => s.nextPendingPermissionId)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const approveAllPermissions = useStore((s) => s.approveAllPermissions)
  const unreadCount = Object.entries(unread).filter(([id, on]) => on && id !== workspace.id).length
  const pendingElsewhere = permissions.filter((p) => p.workspaceId !== workspace.id)
  const pendingElsewhereCount = new Set(pendingElsewhere.map((p) => p.workspaceId)).size
  // 일괄 승인 가능한(=AskUserQuestion 이 아닌) 대기 권한 수(모든 workspace 합산).
  const approvableCount = permissions.filter((p) => p.toolName !== 'AskUserQuestion').length

  const approveAll = async (): Promise<void> => {
    const ok = await confirm({
      title: `Approve ${approvableCount} pending permission${approvableCount > 1 ? 's' : ''}?`,
      body: 'Allows every waiting tool request across all workspaces at once. Questions that need an answer are left untouched.',
      confirmLabel: 'Approve all'
    })
    if (ok) approveAllPermissions()
  }

  const model = modelLabel(workspace.model ?? workspace.lastModel ?? settingsModel)
  const sessionCost = transcript.reduce(
    (sum, it) => sum + (it.type === 'result' ? it.costUsd : 0),
    0
  )
  const running = workspace.status === 'running'

  // 표시 이름: 사용자 override → PR 제목 → worktree 이름 순으로 결정한다.
  const displayName = workspaceDisplayName(workspace, pr?.title)

  const archiveWorkspace = async (): Promise<void> => {
    const ok = await confirm({
      title: `Archive "${displayName}"?`,
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

  const setModel = (value: string): void => {
    void window.api.workspace.setModel(workspace.id, value || null)
  }

  const setEffort = (value: string): void => {
    void window.api.workspace.setEffort(
      workspace.id,
      (value || null) as EffortSetting | null
    )
  }

  const commitName = (): void => {
    const name = (editingName ?? '').trim()
    // 비우면 override 가 지워져 기본 규칙(worktree 이름 → PR 제목)으로 돌아간다.
    if (name !== displayName) void window.api.workspace.rename(workspace.id, name)
    setEditingName(null)
  }

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* 헤더 */}
      <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-[var(--border)]">
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
              className="text-base font-semibold text-neutral-100 bg-[var(--surface)] border border-[var(--border-strong)] rounded px-1.5 py-0.5 outline-none"
            />
          ) : (
            <div
              className="text-base font-semibold text-neutral-100 truncate cursor-text"
              title={`${displayName}\n(double-click to rename · clear to reset)`}
              onDoubleClick={() => setEditingName(displayName)}
            >
              {displayName}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
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

        <span className="flex items-center gap-1 text-xs text-neutral-500 pl-1" title="Model for new turns">
          <Cpu size={12} />
        </span>
        <select
          value={workspace.model ?? ''}
          onChange={(e) => setModel(e.target.value)}
          disabled={running}
          className="no-drag text-xs bg-[var(--surface)] border border-[var(--border)] rounded-md px-1.5 py-1 text-neutral-300 hover:border-[var(--border-2)] focus:outline-none focus:border-[var(--border-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
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

        <span
          className="flex items-center gap-1 text-xs text-neutral-500 pl-1"
          title="Reasoning effort for new turns"
        >
          <Gauge size={12} />
        </span>
        <select
          value={workspace.effort ?? ''}
          onChange={(e) => setEffort(e.target.value)}
          disabled={running}
          className="no-drag text-xs bg-[var(--surface)] border border-[var(--border)] rounded-md px-1.5 py-1 text-neutral-300 hover:border-[var(--border-2)] focus:outline-none focus:border-[var(--border-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
          title={running ? 'Stop the current turn to change effort' : 'Reasoning effort for this workspace'}
        >
          <option value="">Default · {effortLabel(settingsEffort)}</option>
          {EFFORT_OPTIONS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
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
        <HeaderButton
          title={rightPanelOpen ? 'Hide work panel — ⌘J' : 'Show work panel — ⌘J'}
          onClick={toggleRightPanel}
          active={rightPanelOpen}
        >
          <PanelRight size={15} />
        </HeaderButton>

        {/* PR 상태 + 링크: 헤더 우측 끝. 상태별 색·아이콘으로 한눈에 구분. */}
        {(pr || (git && git.ahead > 0)) && (
          <div className="flex items-center pl-2 ml-0.5 border-l border-[var(--border)]">
            {pr ? (
              (() => {
                const { Icon, iconClass, badgeClass } = PR_STYLE[pr.state]
                return (
                  <button
                    onClick={() => void window.api.openExternal(pr.url)}
                    className={
                      'flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border ' + badgeClass
                    }
                    title={`${pr.label} — open pull request #${pr.number} in browser`}
                  >
                    <Icon size={12} className={iconClass} />
                    <span className="opacity-60">#{pr.number}</span>
                    <span className="font-medium">{pr.label}</span>
                    <ExternalLink size={10} className="opacity-50" />
                  </button>
                )
              })()
            ) : (
              <button
                onClick={createPr}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-neutral-300 hover:border-[var(--border-strong)]"
                title="Open a pull request for this branch"
              >
                <GitPullRequestCreate size={12} className="text-[var(--accent-400)]" />
                Create PR
              </button>
            )}
          </div>
        )}
      </div>

      {/* 대화 */}
      <MessageList workspaceId={workspace.id} running={running} />

      {/* 권한 프롬프트 — AskUserQuestion 은 답을 받아야 하므로 질문 UI 로 분기 */}
      {pending &&
        (pending.toolName === 'AskUserQuestion' ? (
          <QuestionPrompt key={pending.requestId} request={pending} />
        ) : (
          <PermissionPrompt request={pending} />
        ))}

      {/* 입력창 바로 위: 일괄 승인 + 다른 세션으로 점프(권한 대기 우선, 그다음 미확인 응답) */}
      {(pendingElsewhereCount > 0 || unreadCount > 0 || approvableCount >= 2) && (
        <div className="px-4">
          <div className="max-w-3xl mx-auto flex justify-end gap-2">
            {approvableCount >= 2 && (
              <button
                onClick={approveAll}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[var(--success-600)]/90 text-white text-xs font-medium hover:bg-[var(--success-500)] shadow-lg"
                title="Approve every pending permission across all workspaces (⇧⌘A)"
              >
                <CircleCheck size={13} />
                Approve all ({approvableCount})
              </button>
            )}
            {pendingElsewhereCount > 0 && (
              <button
                onClick={() => {
                  const id = nextPendingPermissionId()
                  if (id) void selectWorkspace(id)
                }}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[var(--warning-500)]/90 text-black text-xs font-medium hover:bg-[var(--warning-400)] shadow-lg"
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
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[var(--info-600)]/90 text-white text-xs font-medium hover:bg-[var(--info-500)] shadow-lg"
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
        'no-drag h-7 w-7 grid place-items-center rounded-md active:scale-90 ' +
        (danger
          ? 'text-neutral-400 hover:bg-[var(--danger-500)]/15 hover:text-[var(--danger-400)]'
          : active
            ? 'bg-[var(--surface-2)] text-neutral-100'
            : 'text-neutral-400 hover:bg-[var(--surface-2)] hover:text-neutral-100')
      }
    >
      {children}
    </button>
  )
}

const EMPTY: ChatItem[] = []
