import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { exec } from 'node:child_process'
import { getStore } from './store'
import { getTranscripts } from './transcripts'
import {
  addWorktree,
  detectDefaultBranch,
  getStatus,
  isGitRepo,
  listBranches,
  removeWorktree,
  repoNameFromPath,
  sanitizeBranch,
  worktreePathFor
} from './git'
import { generateWorkspaceName } from './names'
import { getPrStatus } from './github'
import {
  getAuthStatus,
  claudeLogin,
  claudeLogout,
  githubLogin,
  githubLogout
} from './auth'
import { IPC } from '@shared/types'
import type {
  AppSettings,
  CreateWorkspaceArgs,
  PermissionDecision,
  PermissionMode,
  Repo,
  ScriptKind
} from '@shared/types'
import type { SessionManager } from './claude/manager'
import type { ScriptRunner } from './scripts'

interface IpcContext {
  sessions: SessionManager
  scripts: ScriptRunner
  getWindow: () => BrowserWindow | null
}

export function registerIpc(ctx: IpcContext): void {
  const store = getStore()

  /** 전체 상태 스냅샷을 모든 창에 방송한다. */
  const broadcastState = (): void => {
    const state = store.getState()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.evtState, state)
    }
  }

  const repoFor = (repoId: string): Repo | undefined =>
    store.getState().repos.find((r) => r.id === repoId)

  // ── 리포 ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.repoAdd, async (): Promise<{ repo?: Repo; error?: string }> => {
    const win = ctx.getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return {}

    const path = result.filePaths[0]
    if (!(await isGitRepo(path))) {
      return { error: 'The selected folder is not a git repository.' }
    }
    if (store.getState().repos.some((r) => r.path === path)) {
      return { error: 'This repository has already been added.' }
    }

    const defaultBranch = await detectDefaultBranch(path)
    const repo: Repo = {
      id: randomUUID(),
      name: repoNameFromPath(path),
      path,
      defaultBranch,
      setupScript: '',
      devScript: '',
      archiveScript: '',
      addedAt: Date.now()
    }
    store.update((st) => st.repos.push(repo))
    broadcastState()
    return { repo }
  })

  ipcMain.handle(
    IPC.repoUpdate,
    (
      _e,
      repoId: string,
      patch: Partial<Pick<Repo, 'name' | 'setupScript' | 'devScript' | 'archiveScript'>>
    ) => {
      store.update((st) => {
        const repo = st.repos.find((r) => r.id === repoId)
        if (repo) Object.assign(repo, patch)
      })
      broadcastState()
    }
  )

  ipcMain.handle(IPC.repoRemove, async (_e, repoId: string) => {
    const repo = repoFor(repoId)
    const workspaces = store.getState().workspaces.filter((w) => w.repoId === repoId)
    for (const ws of workspaces) {
      ctx.sessions.dispose(ws.id)
      ctx.scripts.disposeWorkspace(ws.id)
      getTranscripts().remove(ws.id)
      if (repo) await removeWorktree(repo.path, ws.worktreePath, ws.branch, false)
    }
    store.update((st) => {
      st.workspaces = st.workspaces.filter((w) => w.repoId !== repoId)
      st.repos = st.repos.filter((r) => r.id !== repoId)
    })
    broadcastState()
  })

  ipcMain.handle(IPC.repoListBranches, async (_e, repoId: string): Promise<string[]> => {
    const repo = repoFor(repoId)
    if (!repo) return []
    return listBranches(repo.path).catch(() => [repo.defaultBranch])
  })

  // ── workspace ────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.workspaceCreate,
    async (_e, args: CreateWorkspaceArgs): Promise<{ workspaceId?: string; error?: string }> => {
      const repo = repoFor(args.repoId)
      if (!repo) return { error: 'Repository not found.' }

      // 이름 미입력 시 자동 생성, 베이스 미입력 시 리포 기본 브랜치(main/origin) 사용.
      let rawName = (args.name ?? '').trim()
      if (!rawName) {
        const existing = new Set(
          store.getState().workspaces.filter((w) => w.repoId === repo.id).map((w) => w.branch)
        )
        rawName = generateWorkspaceName(existing)
      }
      const baseBranch = (args.baseBranch ?? '').trim() || repo.defaultBranch
      const branch = sanitizeBranch(rawName)
      const worktreePath = worktreePathFor(repo.path, branch)

      try {
        await addWorktree(repo.path, branch, baseBranch, worktreePath)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }

      const settings = store.getState().settings
      const id = randomUUID()
      store.update((st) =>
        st.workspaces.push({
          id,
          repoId: repo.id,
          name: rawName,
          branch,
          baseBranch,
          worktreePath,
          sessionId: null,
          permissionMode: settings.defaultPermissionMode,
          status: 'idle',
          lastModel: null,
          archived: false,
          createdAt: Date.now(),
          lastActiveAt: Date.now()
        })
      )
      broadcastState()

      // 셋업 스크립트 자동 실행 (설정 ON + 명령 존재 시).
      if (settings.autoRunSetup && repo.setupScript.trim()) {
        ctx.scripts.run(id, 'setup', repo.setupScript, worktreePath)
      }

      return { workspaceId: id }
    }
  )

  // 아카이브: 세션·스크립트를 정리하고 worktree 디렉토리를 제거하되 브랜치·대화 기록·세션 ID 는
  // 유지한다 (언아카이브 시 worktree 를 다시 만들고 같은 세션을 이어갈 수 있다).
  ipcMain.handle(IPC.workspaceArchive, async (_e, workspaceId: string) => {
    const ws = store.getState().workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    const repo = repoFor(ws.repoId)

    ctx.sessions.dispose(workspaceId)
    ctx.scripts.disposeWorkspace(workspaceId)
    // 아카이브 스크립트는 worktree 가 아직 살아 있을 때 실행한다.
    if (repo?.archiveScript.trim()) {
      await ctx.scripts.runOnce(repo.archiveScript, ws.worktreePath)
    }
    if (repo) await removeWorktree(repo.path, ws.worktreePath, ws.branch, false)

    store.update((st) => {
      const w = st.workspaces.find((x) => x.id === workspaceId)
      if (w) {
        w.archived = true
        w.status = 'idle'
      }
    })
    broadcastState()
  })

  // 언아카이브: 브랜치로부터 worktree 를 복원한다.
  ipcMain.handle(IPC.workspaceUnarchive, async (_e, workspaceId: string): Promise<{ error?: string }> => {
    const ws = store.getState().workspaces.find((w) => w.id === workspaceId)
    if (!ws) return { error: 'Workspace not found.' }
    const repo = repoFor(ws.repoId)
    if (!repo) return { error: 'Repository not found.' }

    try {
      await addWorktree(repo.path, ws.branch, ws.baseBranch, ws.worktreePath)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
    store.update((st) => {
      const w = st.workspaces.find((x) => x.id === workspaceId)
      if (w) w.archived = false
    })
    broadcastState()
    return {}
  })

  ipcMain.handle(
    IPC.workspaceRemove,
    async (_e, workspaceId: string, deleteBranch: boolean) => {
      const ws = store.getState().workspaces.find((w) => w.id === workspaceId)
      if (!ws) return
      const repo = repoFor(ws.repoId)

      ctx.sessions.dispose(workspaceId)
      ctx.scripts.disposeWorkspace(workspaceId)
      getTranscripts().remove(workspaceId)
      if (repo) await removeWorktree(repo.path, ws.worktreePath, ws.branch, deleteBranch)

      store.update((st) => {
        st.workspaces = st.workspaces.filter((w) => w.id !== workspaceId)
      })
      broadcastState()
    }
  )

  ipcMain.handle(
    IPC.workspaceSetPermissionMode,
    async (_e, workspaceId: string, mode: PermissionMode) => {
      await ctx.sessions.setPermissionMode(workspaceId, mode)
      broadcastState()
    }
  )

  ipcMain.handle(IPC.workspaceRevealInFinder, (_e, workspaceId: string) => {
    const ws = store.getState().workspaces.find((w) => w.id === workspaceId)
    if (ws) shell.openPath(ws.worktreePath)
  })

  ipcMain.handle(IPC.workspaceOpenInEditor, (_e, workspaceId: string) => {
    const ws = store.getState().workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    // VS Code 의 `code` CLI 를 best-effort 로 호출, 실패하면 Finder 로 폴백.
    exec(`code "${ws.worktreePath}"`, (err) => {
      if (err) shell.openPath(ws.worktreePath)
    })
  })

  // ── 채팅 ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.chatSend, (_e, workspaceId: string, text: string) => {
    ctx.sessions.sendMessage(workspaceId, text)
  })

  ipcMain.handle(IPC.chatInterrupt, (_e, workspaceId: string) => {
    return ctx.sessions.interrupt(workspaceId)
  })

  ipcMain.handle(IPC.chatGetHistory, (_e, workspaceId: string) => {
    return getTranscripts().load(workspaceId)
  })

  ipcMain.handle(
    IPC.permissionRespond,
    (_e, requestId: string, decision: PermissionDecision) => {
      ctx.sessions.respondPermission(requestId, decision)
    }
  )

  // ── 스크립트 ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC.scriptRun, (_e, workspaceId: string, kind: ScriptKind) => {
    const ws = store.getState().workspaces.find((w) => w.id === workspaceId)
    if (!ws) return
    const repo = repoFor(ws.repoId)
    if (!repo) return
    const command = kind === 'setup' ? repo.setupScript : repo.devScript
    ctx.scripts.run(workspaceId, kind, command, ws.worktreePath)
  })

  ipcMain.handle(IPC.scriptStop, (_e, workspaceId: string, kind: ScriptKind) => {
    ctx.scripts.stop(workspaceId, kind)
  })

  ipcMain.handle(IPC.scriptGetStatus, (_e, workspaceId: string) => {
    return ctx.scripts.getStatus(workspaceId)
  })

  // ── git ────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.gitStatus, async (_e, workspaceId: string) => {
    const ws = store.getState().workspaces.find((w) => w.id === workspaceId)
    if (!ws) return null
    return getStatus(ws.worktreePath, ws.baseBranch).catch(() => null)
  })

  ipcMain.handle(IPC.prStatus, async (_e, workspaceId: string) => {
    const ws = store.getState().workspaces.find((w) => w.id === workspaceId)
    if (!ws || ws.archived) return null
    return getPrStatus(ws.worktreePath, ws.branch).catch(() => null)
  })

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  // ── 설정 ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.appGetState, () => store.getState())

  ipcMain.handle(IPC.settingsUpdate, (_e, patch: Partial<AppSettings>) => {
    store.update((st) => Object.assign(st.settings, patch))
    broadcastState()
  })

  // ── 외부 연동 인증 ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.authGetStatus, () => getAuthStatus())
  ipcMain.handle(IPC.authClaudeLogin, () => claudeLogin())
  ipcMain.handle(IPC.authClaudeLogout, () => claudeLogout())
  ipcMain.handle(IPC.authGithubLogin, () => githubLogin())
  ipcMain.handle(IPC.authGithubLogout, () => githubLogout())
}
