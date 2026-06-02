import type {
  AppState,
  AppSettings,
  ChatItem,
  ChatEnvelope,
  CreateWorkspaceArgs,
  GitStatus,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  Repo,
  ScriptExitEvent,
  ScriptKind,
  ScriptOutputEvent,
  ScriptStatus
} from './types'

/**
 * preload 가 `window.api` 로 노출하는 표면. preload 구현과 renderer 소비가
 * 같은 타입을 보도록 shared 에 둔다(SSOT).
 */
export interface DittoApi {
  getState(): Promise<AppState>

  repo: {
    add(): Promise<{ repo?: Repo; error?: string }>
    update(
      repoId: string,
      patch: Partial<Pick<Repo, 'name' | 'setupScript' | 'devScript'>>
    ): Promise<void>
    remove(repoId: string): Promise<void>
    listBranches(repoId: string): Promise<string[]>
  }

  workspace: {
    create(args: CreateWorkspaceArgs): Promise<{ workspaceId?: string; error?: string }>
    remove(workspaceId: string, deleteBranch: boolean): Promise<void>
    setPermissionMode(workspaceId: string, mode: PermissionMode): Promise<void>
    revealInFinder(workspaceId: string): Promise<void>
    openInEditor(workspaceId: string): Promise<void>
  }

  chat: {
    send(workspaceId: string, text: string): Promise<void>
    interrupt(workspaceId: string): Promise<void>
    getHistory(workspaceId: string): Promise<ChatItem[]>
  }

  permission: {
    respond(requestId: string, decision: PermissionDecision): Promise<void>
  }

  script: {
    run(workspaceId: string, kind: ScriptKind): Promise<void>
    stop(workspaceId: string, kind: ScriptKind): Promise<void>
    getStatus(workspaceId: string): Promise<ScriptStatus[]>
  }

  git: {
    status(workspaceId: string): Promise<GitStatus | null>
  }

  settings: {
    update(patch: Partial<AppSettings>): Promise<void>
  }

  // 단방향 이벤트 구독. 반환값은 구독 해제 함수.
  onChat(cb: (e: ChatEnvelope) => void): () => void
  onPermission(cb: (e: PermissionRequest) => void): () => void
  onScriptOutput(cb: (e: ScriptOutputEvent) => void): () => void
  onScriptExit(cb: (e: ScriptExitEvent) => void): () => void
  onState(cb: (state: AppState) => void): () => void
}
