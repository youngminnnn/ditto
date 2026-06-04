import type {
  AppState,
  AppSettings,
  AuthStatus,
  ChatItem,
  ChatEnvelope,
  CreateWorkspaceArgs,
  GitStatus,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  PrStatus,
  Repo,
  ScriptExitEvent,
  ScriptKind,
  ScriptOutputEvent,
  ScriptStatus,
  WorkspaceDiff
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
      patch: Partial<Pick<Repo, 'name' | 'setupScript' | 'devScript' | 'archiveScript'>>
    ): Promise<void>
    remove(repoId: string): Promise<void>
    listBranches(repoId: string): Promise<string[]>
  }

  workspace: {
    create(args: CreateWorkspaceArgs): Promise<{ workspaceId?: string; error?: string }>
    archive(workspaceId: string): Promise<void>
    unarchive(workspaceId: string): Promise<{ error?: string }>
    remove(workspaceId: string, deleteBranch: boolean): Promise<void>
    setPermissionMode(workspaceId: string, mode: PermissionMode): Promise<void>
    setModel(workspaceId: string, model: string | null): Promise<void>
    rename(workspaceId: string, name: string): Promise<void>
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
    diff(workspaceId: string): Promise<WorkspaceDiff | null>
  }

  pr: {
    status(workspaceId: string): Promise<PrStatus | null>
    /** GitHub PR 작성 화면을 브라우저로 연다(`gh pr create --web`). 에러 시 문자열 반환. */
    create(workspaceId: string): Promise<{ error?: string }>
  }

  openExternal(url: string): Promise<void>

  settings: {
    update(patch: Partial<AppSettings>): Promise<void>
  }

  auth: {
    getStatus(): Promise<AuthStatus>
    claudeLogin(): Promise<void>
    claudeLogout(): Promise<void>
    githubLogin(): Promise<void>
    githubLogout(): Promise<void>
  }

  // 단방향 이벤트 구독. 반환값은 구독 해제 함수.
  onChat(cb: (e: ChatEnvelope) => void): () => void
  onPermission(cb: (e: PermissionRequest) => void): () => void
  onScriptOutput(cb: (e: ScriptOutputEvent) => void): () => void
  onScriptExit(cb: (e: ScriptExitEvent) => void): () => void
  onState(cb: (state: AppState) => void): () => void
  /** OS 알림 클릭 시 main 이 보내는 workspace 선택 요청. */
  onSelectWorkspace(cb: (workspaceId: string) => void): () => void
}
