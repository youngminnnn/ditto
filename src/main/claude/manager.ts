import { randomUUID } from 'node:crypto'
import { Notification, type BrowserWindow } from 'electron'
import { getStore } from '../store'
import { getTranscripts } from '../transcripts'
import { ClaudeSession } from './session'
import { clampText } from './clamp'
import { askSideQuestion } from './sideQuestion'
import { runCommandOn, runCommandShortLived, runMcpAction, invalidateAfterReload } from './control'
import { IPC, workspaceDisplayName } from '@shared/types'
import type {
  ChatEvent,
  CommandPanelKind,
  CommandResult,
  ImageAttachment,
  McpAction,
  McpServerInfo,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  Workspace
} from '@shared/types'

type Dispatch = (channel: string, payload: unknown) => void

/**
 * workspace 단위 Claude 세션의 생명주기를 관리하고, 권한 요청을 renderer 로 라우팅한다.
 * 세션은 첫 메시지 전송 시 lazy 하게 생성된다.
 *
 * 창이 비활성일 때 완료/에러/권한대기를 OS 알림으로 알린다 — 병렬 세션을 백그라운드에
 * 돌려두는 사용 패턴에서 "어떤 세션이 내 입력을 기다리는지" 를 놓치지 않게 한다.
 */
export class SessionManager {
  private sessions = new Map<string, ClaudeSession>()
  // requestId → 해당 요청을 띄운 workspace + 응답 resolver. workspace 단위로 dispose 할 때
  // 그 세션이 기다리던 요청만 골라 풀어 주기 위해 workspaceId 를 함께 들고 있는다.
  private pendingPermissions = new Map<
    string,
    { workspaceId: string; resolve: (d: PermissionDecision) => void }
  >()

  constructor(
    private dispatch: Dispatch,
    private getWindow: () => BrowserWindow | null
  ) {}

  private getWorkspace(id: string): Workspace | undefined {
    return getStore().getState().workspaces.find((w) => w.id === id)
  }

  /** worktree 의 원본 repo 절대 경로. ~/.claude.json 의 project 스코프 MCP 조회에 쓴다. */
  private getRepoPath(repoId: string): string | null {
    return getStore().getState().repos.find((r) => r.id === repoId)?.path ?? null
  }

  private ensure(workspaceId: string): ClaudeSession | null {
    const existing = this.sessions.get(workspaceId)
    if (existing) return existing

    const ws = this.getWorkspace(workspaceId)
    if (!ws) return null

    const settings = getStore().getState().settings
    const session = new ClaudeSession({
      cwd: ws.worktreePath,
      repoPath: this.getRepoPath(ws.repoId),
      // workspace 오버라이드가 있으면 우선, 없으면 전역 설정 모델.
      model: ws.model ?? settings.model,
      permissionMode: ws.permissionMode,
      autoCompact: settings.autoCompact,
      resumeSessionId: ws.sessionId,
      emit: (event) => this.emit(workspaceId, event),
      persist: (item) => getTranscripts().upsert(workspaceId, item),
      requestPermission: (req) => this.requestPermission(workspaceId, req),
      onSessionId: (sid) => this.onSessionId(workspaceId, sid),
      // query 루프가 result 없이 끝나 'running' 에 갇히면(세션이 죽음) 알림 없이 idle 로 푼다.
      settleIdle: () => this.forceIdle(workspaceId)
    })
    this.sessions.set(workspaceId, session)
    return session
  }

  sendMessage(workspaceId: string, text: string, images?: ImageAttachment[]): void {
    this.ensure(workspaceId)?.send(text, images)
  }

  /**
   * /btw 사이드 질문을 띄운다. 메인 세션과 분리된 임시 query 로 처리하므로 세션 생성·상태에
   * 영향을 주지 않으며(작업 중에도 병렬), 진행 상태만 evtSideQuestion 으로 흘려보낸다.
   */
  sideQuestion(workspaceId: string, question: string): void {
    const ws = this.getWorkspace(workspaceId)
    if (!ws) return

    const trimmed = question.trim()
    if (!trimmed) return

    const settings = getStore().getState().settings
    const id = randomUUID()

    this.dispatch(IPC.evtSideQuestion, { workspaceId, id, phase: 'start', question: trimmed })

    void askSideQuestion({
      cwd: ws.worktreePath,
      resumeSessionId: ws.sessionId,
      model: ws.model ?? settings.model,
      question: trimmed,
      onDelta: (text) =>
        this.dispatch(IPC.evtSideQuestion, { workspaceId, id, phase: 'delta', text: clampText(text) })
    })
      .then(() => this.dispatch(IPC.evtSideQuestion, { workspaceId, id, phase: 'done' }))
      .catch((err) =>
        this.dispatch(IPC.evtSideQuestion, {
          workspaceId,
          id,
          phase: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      )
  }

  /**
   * 인터랙티브 명령(/mcp·/context·/reload-plugins 등)을 실행해 카드용 데이터를 돌려준다.
   * 라이브 세션 쿼리가 있으면 그 위에서(=지금 돌고 있는 에이전트 기준), 없으면 단명 쿼리로 폴백한다.
   */
  async runCommand(workspaceId: string, kind: CommandPanelKind): Promise<CommandResult> {
    const ws = this.getWorkspace(workspaceId)
    if (!ws) throw new Error('Workspace not found.')

    const live = this.sessions.get(workspaceId)?.liveQuery
    const result = live
      ? await runCommandOn(kind, live)
      : await runCommandShortLived(kind, ws.worktreePath, this.getRepoPath(ws.repoId))
    invalidateAfterReload(kind, ws.worktreePath)
    return result
  }

  /**
   * /mcp 패널의 서버별 동작(재연결·활성/비활성)을 실행하고 갱신된 서버 목록을 돌려준다.
   *
   * 동작은 살아 있는 세션 제어 채널 위에서만 의미가 있으므로(연결은 세션별 CLI 프로세스에 묶임),
   * 라이브 세션이 있으면 그 위에서, 없으면 세션을 만들고 메시지 없이 query 를 띄워(warm up) 적용한다.
   * 이렇게 하면 Claude Code CLI 처럼 토글/재연결이 곧바로 반영되고, 이후 대화에서도 유지된다.
   */
  async mcpAction(
    workspaceId: string,
    serverName: string,
    action: McpAction
  ): Promise<McpServerInfo[]> {
    const session = this.ensure(workspaceId)
    if (!session) throw new Error('Workspace not found.')
    return runMcpAction(action, serverName, session.ensureLiveQuery())
  }

  async interrupt(workspaceId: string): Promise<void> {
    await this.sessions.get(workspaceId)?.interrupt()
    // 세션이 없거나(앱 재시작 후 상태만 잔존), 인증이 끊겨 interrupt 후에도 result 가
    // 오지 않는 끊긴 세션에서도 사이드바가 '진행 중'에 갇히지 않도록 idle 로 확정한다.
    this.forceIdle(workspaceId)
  }

  async setPermissionMode(workspaceId: string, mode: PermissionMode): Promise<void> {
    getStore().update((st) => {
      const w = st.workspaces.find((x) => x.id === workspaceId)
      if (w) w.permissionMode = mode
    })
    await this.sessions.get(workspaceId)?.setPermissionMode(mode)
  }

  /**
   * workspace 의 모델 오버라이드를 바꾼다. 모델은 query 시작 시점에 고정되므로,
   * 이미 만들어진 세션은 dispose 한다 — 다음 메시지에서 새 모델로 query 를 다시 열되
   * resume(세션 ID)로 디스크의 대화 맥락을 이어받는다.
   */
  setModel(workspaceId: string, model: string | null): void {
    getStore().update((st) => {
      const w = st.workspaces.find((x) => x.id === workspaceId)
      if (w) w.model = model
    })
    this.dispose(workspaceId)
  }

  dispose(workspaceId: string): void {
    const session = this.sessions.get(workspaceId)
    if (session) {
      session.dispose()
      this.sessions.delete(workspaceId)
    }

    // 세션이 사라지면 그 세션이 기다리던 권한 요청은 응답받을 수 없으므로, deny 로 풀어
    // 메인측 Promise 누수를 막고 renderer 의 stale 프롬프트도 제거한다.
    for (const [requestId, entry] of this.pendingPermissions) {
      if (entry.workspaceId !== workspaceId) continue
      this.pendingPermissions.delete(requestId)
      entry.resolve({ behavior: 'deny' })
      this.dispatch(IPC.evtPermissionCancel, requestId)
    }
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    for (const { resolve } of this.pendingPermissions.values()) resolve({ behavior: 'deny' })
    this.pendingPermissions.clear()
  }

  /**
   * Claude 로그아웃 등으로 모든 세션의 인증이 한꺼번에 무효화됐을 때 호출한다.
   * 인증이 끊긴 세션은 더 진행되지도 interrupt 로 멈춰지지도 않아 '진행 중'에 갇히므로,
   * 세션을 전부 정리하고 진행 중이던 workspace 상태를 idle 로 되돌려(렌더러에도 방출) 풀어 준다.
   */
  abortAll(): void {
    const running = getStore()
      .getState()
      .workspaces.filter((w) => w.status === 'running')
      .map((w) => w.id)
    this.disposeAll()
    for (const id of running) this.forceIdle(id)
  }

  respondPermission(requestId: string, decision: PermissionDecision): void {
    const entry = this.pendingPermissions.get(requestId)
    if (entry) {
      this.pendingPermissions.delete(requestId)
      entry.resolve(decision)
    }
  }

  // ── 내부 ───────────────────────────────────────────────────────────────

  /**
   * workspace 를 idle 로 강제 확정한다(store + 렌더러). emit('status') 와 달리 완료 알림을
   * 띄우지 않는다 — 중단/인증 무효화로 푸는 경우라 "Response complete" 알림은 부적절하다.
   */
  private forceIdle(workspaceId: string): void {
    getStore().update((st) => {
      const w = st.workspaces.find((x) => x.id === workspaceId)
      if (w) w.status = 'idle'
    })
    this.dispatch(IPC.evtChat, { workspaceId, event: { type: 'status', status: 'idle' } })
  }

  private emit(workspaceId: string, event: ChatEvent): void {
    // 상태·모델 변화는 store 에도 반영해 재시작/새 창에서도 사이드바가 일치하도록 한다.
    if (event.type === 'status') {
      getStore().update((st) => {
        const w = st.workspaces.find((x) => x.id === workspaceId)
        if (w) {
          w.status = event.status
          w.lastActiveAt = Date.now()
        }
      })
      // 창이 비활성일 때만 완료/에러를 OS 알림으로. (활성 창은 사이드바·알림음으로 충분)
      if (event.status === 'idle') this.notify(workspaceId, 'Response complete', false)
      else if (event.status === 'error') this.notify(workspaceId, 'Session error', true)
    } else if (event.type === 'session' && event.model) {
      getStore().update((st) => {
        const w = st.workspaces.find((x) => x.id === workspaceId)
        if (w) w.lastModel = event.model ?? w.lastModel
      })
    }
    this.dispatch(IPC.evtChat, { workspaceId, event })
  }

  private onSessionId(workspaceId: string, sessionId: string): void {
    getStore().update((st) => {
      const w = st.workspaces.find((x) => x.id === workspaceId)
      if (w) {
        w.sessionId = sessionId
        w.lastActiveAt = Date.now()
      }
    })
  }

  private requestPermission(
    workspaceId: string,
    req: Omit<PermissionRequest, 'requestId' | 'workspaceId'>
  ): Promise<PermissionDecision> {
    const requestId = randomUUID()
    const full: PermissionRequest = { requestId, workspaceId, ...req }
    // 백그라운드 세션이 권한 대기로 멈춘 것을 놓치지 않도록 비활성 창에서는 알린다.
    this.notify(workspaceId, `Needs permission: ${req.displayName ?? req.toolName}`, false)
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingPermissions.set(requestId, { workspaceId, resolve })
      this.dispatch(IPC.evtPermission, full)
    })
  }

  /** 창이 비활성일 때 OS 알림을 띄운다. 클릭하면 창을 포커스하고 해당 workspace 를 연다. */
  private notify(workspaceId: string, body: string, urgent: boolean): void {
    const win = this.getWindow()
    if (win && win.isFocused()) return
    if (!Notification.isSupported()) return

    const ws = this.getWorkspace(workspaceId)
    const title = ws ? `${urgent ? '⚠️ ' : ''}${workspaceDisplayName(ws)}` : 'Ditto'
    const notification = new Notification({ title, body, silent: false })
    notification.on('click', () => {
      const w = this.getWindow()
      if (w) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      }
      this.dispatch(IPC.evtSelectWorkspace, workspaceId)
    })
    notification.show()
  }
}
