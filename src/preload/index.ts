import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { DittoApi } from '@shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener as never)
  return () => ipcRenderer.removeListener(channel, listener as never)
}

const api: DittoApi = {
  getState: () => ipcRenderer.invoke(IPC.appGetState),

  repo: {
    add: () => ipcRenderer.invoke(IPC.repoAdd),
    update: (repoId, patch) => ipcRenderer.invoke(IPC.repoUpdate, repoId, patch),
    remove: (repoId) => ipcRenderer.invoke(IPC.repoRemove, repoId),
    listBranches: (repoId) => ipcRenderer.invoke(IPC.repoListBranches, repoId)
  },

  workspace: {
    create: (args) => ipcRenderer.invoke(IPC.workspaceCreate, args),
    archive: (workspaceId) => ipcRenderer.invoke(IPC.workspaceArchive, workspaceId),
    unarchive: (workspaceId) => ipcRenderer.invoke(IPC.workspaceUnarchive, workspaceId),
    remove: (workspaceId, deleteBranch) =>
      ipcRenderer.invoke(IPC.workspaceRemove, workspaceId, deleteBranch),
    setPermissionMode: (workspaceId, mode) =>
      ipcRenderer.invoke(IPC.workspaceSetPermissionMode, workspaceId, mode),
    setModel: (workspaceId, model) => ipcRenderer.invoke(IPC.workspaceSetModel, workspaceId, model),
    rename: (workspaceId, name) => ipcRenderer.invoke(IPC.workspaceRename, workspaceId, name),
    revealInFinder: (workspaceId) => ipcRenderer.invoke(IPC.workspaceRevealInFinder, workspaceId),
    openInEditor: (workspaceId) => ipcRenderer.invoke(IPC.workspaceOpenInEditor, workspaceId)
  },

  chat: {
    send: (workspaceId, text) => ipcRenderer.invoke(IPC.chatSend, workspaceId, text),
    interrupt: (workspaceId) => ipcRenderer.invoke(IPC.chatInterrupt, workspaceId),
    getHistory: (workspaceId) => ipcRenderer.invoke(IPC.chatGetHistory, workspaceId)
  },

  permission: {
    respond: (requestId, decision) =>
      ipcRenderer.invoke(IPC.permissionRespond, requestId, decision)
  },

  script: {
    run: (workspaceId, kind) => ipcRenderer.invoke(IPC.scriptRun, workspaceId, kind),
    stop: (workspaceId, kind) => ipcRenderer.invoke(IPC.scriptStop, workspaceId, kind),
    getStatus: (workspaceId) => ipcRenderer.invoke(IPC.scriptGetStatus, workspaceId)
  },

  git: {
    status: (workspaceId) => ipcRenderer.invoke(IPC.gitStatus, workspaceId),
    diff: (workspaceId) => ipcRenderer.invoke(IPC.gitDiff, workspaceId)
  },

  pr: {
    status: (workspaceId) => ipcRenderer.invoke(IPC.prStatus, workspaceId),
    create: (workspaceId) => ipcRenderer.invoke(IPC.prCreate, workspaceId),
    checks: (workspaceId) => ipcRenderer.invoke(IPC.prChecks, workspaceId)
  },

  fs: {
    list: (workspaceId, relPath) => ipcRenderer.invoke(IPC.fsList, workspaceId, relPath),
    read: (workspaceId, relPath) => ipcRenderer.invoke(IPC.fsRead, workspaceId, relPath)
  },

  commands: {
    list: (workspaceId) => ipcRenderer.invoke(IPC.commandsList, workspaceId)
  },

  terminal: {
    start: (workspaceId, cols, rows) =>
      ipcRenderer.invoke(IPC.terminalStart, workspaceId, cols, rows),
    input: (workspaceId, data) => ipcRenderer.invoke(IPC.terminalInput, workspaceId, data),
    resize: (workspaceId, cols, rows) =>
      ipcRenderer.invoke(IPC.terminalResize, workspaceId, cols, rows),
    kill: (workspaceId) => ipcRenderer.invoke(IPC.terminalKill, workspaceId),
    onData: (cb) => subscribe(IPC.evtTerminalData, cb),
    onExit: (cb) => subscribe(IPC.evtTerminalExit, cb)
  },

  app: {
    setBadgeCount: (count) => ipcRenderer.invoke(IPC.appSetBadge, count)
  },

  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),

  settings: {
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },

  auth: {
    getStatus: () => ipcRenderer.invoke(IPC.authGetStatus),
    claudeLogin: () => ipcRenderer.invoke(IPC.authClaudeLogin),
    claudeLogout: () => ipcRenderer.invoke(IPC.authClaudeLogout),
    githubLogin: () => ipcRenderer.invoke(IPC.authGithubLogin),
    githubLogout: () => ipcRenderer.invoke(IPC.authGithubLogout)
  },

  onChat: (cb) => subscribe(IPC.evtChat, cb),
  onPermission: (cb) => subscribe(IPC.evtPermission, cb),
  onScriptOutput: (cb) => subscribe(IPC.evtScriptOutput, cb),
  onScriptExit: (cb) => subscribe(IPC.evtScriptExit, cb),
  onState: (cb) => subscribe(IPC.evtState, cb),
  onSelectWorkspace: (cb) => subscribe(IPC.evtSelectWorkspace, cb),
  onWindowFocus: (cb) => subscribe(IPC.evtWindowFocus, () => cb())
}

contextBridge.exposeInMainWorld('api', api)
