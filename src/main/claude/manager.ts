import { randomUUID } from 'node:crypto'
import { getStore } from '../store'
import { getTranscripts } from '../transcripts'
import { ClaudeSession } from './session'
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
 */
export class SessionManager {
  private sessions = new Map<string, ClaudeSession>()
  private pendingPermissions = new Map<string, (d: PermissionDecision) => void>()

  constructor(private dispatch: Dispatch) {}

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
      model: settings.model,
      permissionMode: ws.permissionMode,
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
    // 상태 변화는 store 에도 반영해 재시작/새 창에서도 사이드바가 일치하도록 한다.
    if (event.type === 'status') {
      getStore().update((st) => {
        const w = st.workspaces.find((x) => x.id === workspaceId)
        if (w) {
          w.status = event.status
          w.lastActiveAt = Date.now()
        }
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
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingPermissions.set(requestId, resolve)
      this.dispatch(IPC.evtPermission, full)
    })
  }
}
