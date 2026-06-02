/**
 * main ↔ renderer 가 공유하는 도메인 타입과 IPC 계약.
 * preload 가 이 타입을 그대로 노출하므로, 채널 이름·페이로드 모양의 단일 출처(SSOT)다.
 */

// ── Claude Code 권한 모드 ───────────────────────────────────────────────
// Claude Code 가 Shift+Tab 으로 순환하는 모드와 동일하게 노출한다
// (default → accept edits → plan → auto).
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto'

// ── 도메인 엔티티 ────────────────────────────────────────────────────────

/** 연결된 git 리포지토리(메인 체크아웃). 모든 workspace 의 부모. */
export interface Repo {
  id: string
  name: string
  /** 메인 리포의 절대 경로 */
  path: string
  /** 감지된 기본 브랜치 (main/master 등) */
  defaultBranch: string
  /** workspace 생성 후 1회 실행하는 셋업 명령 (예: "npm install"). 비어 있으면 미실행. */
  setupScript: string
  /** 개발 서버 실행 명령 (예: "npm run dev"). 비어 있으면 미실행. */
  devScript: string
  /** workspace 아카이브 시 worktree 에서 실행하는 정리 명령. 비어 있으면 미실행. */
  archiveScript: string
  addedAt: number
}

export type WorkspaceStatus = 'idle' | 'running' | 'error'

/** 하나의 작업 단위. git worktree + 전용 브랜치 + Claude 세션 1개. */
export interface Workspace {
  id: string
  repoId: string
  /** 표시 이름 */
  name: string
  /** 이 workspace 전용 git 브랜치 */
  branch: string
  /** 브랜치를 분기한 베이스 브랜치 */
  baseBranch: string
  /** worktree 절대 경로 */
  worktreePath: string
  /** resume 용 Claude 세션 ID. 아직 세션을 시작하지 않았으면 null. */
  sessionId: string | null
  permissionMode: PermissionMode
  status: WorkspaceStatus
  /** init 메시지에서 확인된 실제 모델명(예: "claude-opus-4-8[1m]"). 표시용. */
  lastModel: string | null
  /** 아카이브되면 사이드바 기본 목록에서 숨기고 worktree 를 제거한다(브랜치·기록은 유지). */
  archived: boolean
  createdAt: number
  lastActiveAt: number
}

export interface AppSettings {
  defaultPermissionMode: PermissionMode
  /** workspace 생성 직후 setupScript 를 자동 실행할지 */
  autoRunSetup: boolean
  /** 사용할 모델 ID (예: "claude-opus-4-8[1m]"). */
  model: string | null
  /** 세션 응답이 완료되면 소리로 알림. */
  soundOnComplete: boolean
  /**
   * true 면 새 workspace 생성 시 이름·베이스 브랜치를 직접 입력하는 모달을 띄운다.
   * false(기본) 면 이름을 자동 생성하고 베이스는 리포 기본 브랜치(main/origin)로 즉시 만든다.
   */
  manualWorkspaceSetup: boolean
  /** 최초 실행 온보딩(Claude/GitHub 연동 안내)을 완료했는지. */
  onboarded: boolean
}

export interface AppState {
  repos: Repo[]
  workspaces: Workspace[]
  settings: AppSettings
}

// ── 채팅 트랜스크립트 ────────────────────────────────────────────────────
// main 이 권위 있는 트랜스크립트를 보유·영속화하고, renderer 는 이벤트로 동기화한다.

export type ChatItem =
  | { id: string; type: 'user'; text: string; ts: number }
  | { id: string; type: 'assistant'; text: string; ts: number; streaming?: boolean }
  | { id: string; type: 'thinking'; text: string; ts: number; streaming?: boolean }
  | { id: string; type: 'tool_use'; toolId: string; name: string; input: unknown; ts: number }
  | { id: string; type: 'tool_result'; toolId: string; text: string; isError: boolean; ts: number }
  | {
      id: string
      type: 'result'
      subtype: string
      isError: boolean
      durationMs: number
      numTurns: number
      costUsd: number
      ts: number
    }
  | { id: string; type: 'error'; text: string; ts: number }
  | { id: string; type: 'system'; text: string; ts: number }

/** main → renderer 스트리밍 이벤트. renderer 는 이를 트랜스크립트에 반영한다. */
export type ChatEvent =
  /** id 기준 append-or-replace. 권위 있는 완성 항목. */
  | { type: 'item'; item: ChatItem }
  /** assistant/thinking 버블(id)에 텍스트 조각을 이어붙임. */
  | { type: 'delta'; id: string; itemType: 'assistant' | 'thinking'; text: string }
  /** workspace 실행 상태 변화. */
  | { type: 'status'; status: WorkspaceStatus }
  /** 세션 ID·모델 확정/갱신 (init 메시지 기준). */
  | { type: 'session'; sessionId: string; model?: string }

// ── 권한 프롬프트 (canUseTool → UI) ──────────────────────────────────────

export interface PermissionRequest {
  requestId: string
  workspaceId: string
  toolName: string
  /** bridge 가 렌더한 사람이 읽을 프롬프트 문장 (예: "Claude wants to read foo.txt") */
  title?: string
  /** 버튼 라벨용 짧은 명사구 (예: "Read file") */
  displayName?: string
  input: Record<string, unknown>
  decisionReason?: string
}

export type PermissionDecision =
  | { behavior: 'allow'; rememberForSession?: boolean }
  | { behavior: 'deny' }

// ── 스크립트 실행 (setup / dev) ──────────────────────────────────────────

export type ScriptKind = 'setup' | 'dev'

export interface ScriptOutputEvent {
  workspaceId: string
  kind: ScriptKind
  stream: 'stdout' | 'stderr'
  chunk: string
}

export interface ScriptExitEvent {
  workspaceId: string
  kind: ScriptKind
  code: number | null
}

export type ScriptRunState = 'idle' | 'running' | 'exited'

export interface ScriptStatus {
  kind: ScriptKind
  state: ScriptRunState
  exitCode: number | null
}

// ── git 상태 (사이드바 배지용 경량 정보) ─────────────────────────────────

export interface GitStatus {
  branch: string
  /** base 대비 앞선/뒤처진 커밋 수 */
  ahead: number
  behind: number
  /** 변경된(staged + unstaged + untracked) 파일 수 */
  changedFiles: number
}

// ── IPC 채널 이름 ────────────────────────────────────────────────────────

export const IPC = {
  // 양방향 호출 (renderer.invoke → main.handle)
  appGetState: 'app:getState',
  repoAdd: 'repo:add',
  repoRemove: 'repo:remove',
  repoUpdate: 'repo:update',
  repoListBranches: 'repo:listBranches',
  workspaceCreate: 'workspace:create',
  workspaceArchive: 'workspace:archive',
  workspaceUnarchive: 'workspace:unarchive',
  workspaceRemove: 'workspace:remove',
  workspaceSetPermissionMode: 'workspace:setPermissionMode',
  workspaceOpenInEditor: 'workspace:openInEditor',
  workspaceRevealInFinder: 'workspace:revealInFinder',
  chatSend: 'chat:send',
  chatInterrupt: 'chat:interrupt',
  chatGetHistory: 'chat:getHistory',
  permissionRespond: 'permission:respond',
  scriptRun: 'script:run',
  scriptStop: 'script:stop',
  scriptGetStatus: 'script:getStatus',
  gitStatus: 'git:status',
  prStatus: 'pr:status',
  openExternal: 'shell:openExternal',
  settingsUpdate: 'settings:update',
  authGetStatus: 'auth:getStatus',
  authClaudeLogin: 'auth:claudeLogin',
  authClaudeLogout: 'auth:claudeLogout',
  authGithubLogin: 'auth:githubLogin',
  authGithubLogout: 'auth:githubLogout',

  // 단방향 이벤트 (main.send → renderer.on)
  evtChat: 'evt:chat',
  evtPermission: 'evt:permission',
  evtScriptOutput: 'evt:scriptOutput',
  evtScriptExit: 'evt:scriptExit',
  evtState: 'evt:state'
} as const

// ── IPC 페이로드 타입 ────────────────────────────────────────────────────

export interface CreateWorkspaceArgs {
  repoId: string
  /** 비어 있으면 main 이 고유 이름을 자동 생성한다. */
  name?: string
  /** 비어 있으면 리포 기본 브랜치를 사용한다. */
  baseBranch?: string
}

// ── 외부 연동 인증 상태 (Claude / GitHub) ────────────────────────────────

export interface ClaudeAuthStatus {
  loggedIn: boolean
  email?: string
  orgName?: string
  subscriptionType?: string
  authMethod?: string
}

export interface GithubAuthStatus {
  loggedIn: boolean
  account?: string
  protocol?: string
}

export interface AuthStatus {
  claude: ClaudeAuthStatus
  github: GithubAuthStatus
}

// ── GitHub PR 상태 (workspace 브랜치 기준) ───────────────────────────────

export interface PrStatus {
  number: number
  url: string
  /** 표시용 라벨: Draft / Review required / Changes requested / Ready to merge / Open / Merged / Closed */
  label: string
}

export interface ChatEnvelope {
  workspaceId: string
  event: ChatEvent
}
