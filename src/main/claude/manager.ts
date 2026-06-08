import { randomUUID } from 'node:crypto'
import { Notification, type BrowserWindow } from 'electron'
import { getStore } from '../store'
import { getTranscripts } from '../transcripts'
import { ClaudeSession } from './session'
import { askSideQuestion } from './sideQuestion'
import { IPC } from '@shared/types'
import type {
  ChatEvent,
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
  private pendingPermissions = new Map<string, (d: PermissionDecision) => void>()

  constructor(
    private dispatch: Dispatch,
    private getWindow: () => BrowserWindow | null
  ) {}

  private getWorkspace(id: string): Workspace | undefined {
    return getStore().getState().workspaces.find((w) => w.id === id)
  }

  private ensure(workspaceId: string): ClaudeSession | null {
    const existing = this.sessions.get(workspaceId)
    if (existing) return existing

    const ws = this.getWorkspace(workspaceId)
    if (!ws) return null

    const settings = getStore().getState().settings
    const session = new ClaudeSession({
      cwd: ws.worktreePath,
      // workspace 오버라이드가 있으면 우선, 없으면 전역 설정 모델.
      model: ws.model ?? settings.model,
      permissionMode: ws.permissionMode,
      resumeSessionId: ws.sessionId,
      emit: (event) => this.emit(workspaceId, event),
      persist: (item) => getTranscripts().upsert(workspaceId, item),
      requestPermission: (req) => this.requestPermission(workspaceId, req),
      onSessionId: (sid) => this.onSessionId(workspaceId, sid)
    })
    this.sessions.set(workspaceId, session)
    return session
  }

  sendMessage(workspaceId: string, text: string): void {
    this.ensure(workspaceId)?.send(text)
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
        this.dispatch(IPC.evtSideQuestion, { workspaceId, id, phase: 'delta', text })
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

  interrupt(workspaceId: string): Promise<void> {
    return this.sessions.get(workspaceId)?.interrupt() ?? Promise.resolve()
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
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    for (const resolve of this.pendingPermissions.values()) resolve({ behavior: 'deny' })
    this.pendingPermissions.clear()
  }

  respondPermission(requestId: string, decision: PermissionDecision): void {
    const resolve = this.pendingPermissions.get(requestId)
    if (resolve) {
      this.pendingPermissions.delete(requestId)
      resolve(decision)
    }
  }

  // ── 내부 ───────────────────────────────────────────────────────────────

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
      this.pendingPermissions.set(requestId, resolve)
      this.dispatch(IPC.evtPermission, full)
    })
  }

  /** 창이 비활성일 때 OS 알림을 띄운다. 클릭하면 창을 포커스하고 해당 workspace 를 연다. */
  private notify(workspaceId: string, body: string, urgent: boolean): void {
    const win = this.getWindow()
    if (win && win.isFocused()) return
    if (!Notification.isSupported()) return

    const ws = this.getWorkspace(workspaceId)
    const title = ws ? `${urgent ? '⚠️ ' : ''}${ws.name}` : 'Ditto'
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
