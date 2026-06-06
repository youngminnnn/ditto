import type {
  AppState,
  AppSettings,
  AuthStatus,
  ChatItem,
  ChatEnvelope,
  CreateWorkspaceArgs,
  DirEntry,
  FileContent,
  GitStatus,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  PrChecks,
  PrStatus,
  Repo,
  ScriptExitEvent,
  ScriptKind,
  ScriptOutputEvent,
  ScriptStatus,
  SlashCommandInfo,
  TerminalDataEvent,
  TerminalExitEvent,
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
    create(
      args: CreateWorkspaceArgs
    ): Promise<{ workspaceId?: string; name?: string; branch?: string; error?: string }>
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
    /** PR 의 CI 체크 롤업(Check 탭). PR 이 없으면 null. */
    checks(workspaceId: string): Promise<PrChecks | null>
  }

  fs: {
    /** worktree 내 디렉토리 항목 나열 (relPath 가 '' 이면 루트). */
    list(workspaceId: string, relPath: string): Promise<DirEntry[]>
    /** worktree 내 파일 1개 읽기. 바이너리/과대 파일은 본문 없이 표시 정보만. */
    read(workspaceId: string, relPath: string): Promise<FileContent | null>
  }

  commands: {
    /** 입력창 자동완성용 슬래시 명령/스킬 목록(/btw, /insights, 사용자 스킬 등). */
    list(workspaceId: string): Promise<SlashCommandInfo[]>
  }

  terminal: {
    /** workspace PTY 를 보장하고 현재 화면 버퍼를 재생한다. */
    start(workspaceId: string, cols: number, rows: number): Promise<void>
    input(workspaceId: string, data: string): Promise<void>
    resize(workspaceId: string, cols: number, rows: number): Promise<void>
    kill(workspaceId: string): Promise<void>
    onData(cb: (e: TerminalDataEvent) => void): () => void
    onExit(cb: (e: TerminalExitEvent) => void): () => void
  }

  app: {
    /** macOS Dock 의 미확인 빨간 배지 개수. 0 이면 지운다. */
    setBadgeCount(count: number): Promise<void>
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
  /** main 창이 포커스를 얻었을 때의 알림(미확인 표시 해제 트리거). */
  onWindowFocus(cb: () => void): () => void
  /** main 창이 포커스를 잃었을 때의 알림(이후 완료를 미확인으로 잡는 신뢰 신호). */
  onWindowBlur(cb: () => void): () => void
}
