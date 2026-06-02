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
      return { error: '선택한 폴더가 git 리포지토리가 아닙니다.' }
    }
    if (store.getState().repos.some((r) => r.path === path)) {
      return { error: '이미 추가된 리포지토리입니다.' }
    }

    const defaultBranch = await detectDefaultBranch(path)
    const repo: Repo = {
      id: randomUUID(),
      name: repoNameFromPath(path),
      path,
      defaultBranch,
      setupScript: '',
      devScript: '',
      addedAt: Date.now()
    }
    store.update((st) => st.repos.push(repo))
    broadcastState()
    return { repo }
  })

  ipcMain.handle(
    IPC.repoUpdate,
    (_e, repoId: string, patch: Partial<Pick<Repo, 'name' | 'setupScript' | 'devScript'>>) => {
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
      if (!repo) return { error: '리포지토리를 찾을 수 없습니다.' }

      const branch = sanitizeBranch(args.name)
      const worktreePath = worktreePathFor(repo.path, branch)

      try {
        await addWorktree(repo.path, branch, args.baseBranch, worktreePath)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }

      const settings = store.getState().settings
      const id = randomUUID()
      store.update((st) =>
        st.workspaces.push({
          id,
          repoId: repo.id,
          name: args.name.trim() || branch,
          branch,
          baseBranch: args.baseBranch,
          worktreePath,
          sessionId: null,
          permissionMode: settings.defaultPermissionMode,
          status: 'idle',
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

  // ── 설정 ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.appGetState, () => store.getState())

  ipcMain.handle(IPC.settingsUpdate, (_e, patch: Partial<AppSettings>) => {
    store.update((st) => Object.assign(st.settings, patch))
    broadcastState()
  })
}
