import { create } from 'zustand'
import type {
  AppState,
  AuthStatus,
  ChatEnvelope,
  ChatItem,
  GitStatus,
  PermissionRequest,
  PrStatus,
  ScriptKind,
  ScriptStatus,
  Workspace
} from '@shared/types'
import { playNotification } from './lib/sound'

export const scriptKey = (workspaceId: string, kind: ScriptKind): string => `${workspaceId}:${kind}`

export type ToastKind = 'info' | 'success' | 'error'
export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
}
interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

let toastSeq = 0

interface UIState {
  ready: boolean
  app: AppState | null
  selectedWorkspaceId: string | null
  transcripts: Record<string, ChatItem[]>
  loadedTranscripts: Record<string, boolean>
  scriptOutput: Record<string, string>
  scriptStatus: Record<string, ScriptStatus[]>
  gitStatus: Record<string, GitStatus | null>
  prStatus: Record<string, PrStatus | null>
  permissions: PermissionRequest[]
  authStatus: AuthStatus | null
  /** 응답이 완료됐지만 사용자가 아직 보지 않은 workspace. */
  unread: Record<string, boolean>
  /** workspace 전환에도 살아남아야 하는 입력창 초안. */
  drafts: Record<string, string>
  /** workspace 별 대화 스크롤 위치(복원용). */
  scrollPositions: Record<string, number>
  /** workspace 별 스크립트 패널 열림 상태. */
  scriptPanelOpen: Record<string, boolean>
  toasts: Toast[]
  confirmState: ConfirmState | null

  init: () => Promise<void>
  selectWorkspace: (id: string | null) => Promise<void>
  refreshGit: (workspaceId: string) => Promise<void>
  refreshPr: (workspaceId: string) => Promise<void>
  refreshScriptStatus: (workspaceId: string) => Promise<void>
  refreshAuth: () => Promise<void>
  dismissPermission: (requestId: string) => void
  nextUnreadId: () => string | null
  /** 다른 workspace 중 권한 대기 중인 첫 항목. */
  nextPendingPermissionId: () => string | null
  setDraft: (workspaceId: string, text: string) => void
  setScrollPosition: (workspaceId: string, top: number) => void
  setScriptPanelOpen: (workspaceId: string, open: boolean) => void
  pushToast: (kind: ToastKind, message: string) => void
  dismissToast: (id: string) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  resolveConfirm: (ok: boolean) => void
}

let initialized = false

function upsertItem(items: ChatItem[], item: ChatItem): ChatItem[] {
  const idx = items.findIndex((i) => i.id === item.id)
  if (idx === -1) return [...items, item]
  const next = items.slice()
  next[idx] = item
  return next
}

export const useStore = create<UIState>((set, get) => ({
  ready: false,
  app: null,
  selectedWorkspaceId: null,
  transcripts: {},
  loadedTranscripts: {},
  scriptOutput: {},
  scriptStatus: {},
  gitStatus: {},
  prStatus: {},
  permissions: [],
  authStatus: null,
  unread: {},
  drafts: {},
  scrollPositions: {},
  scriptPanelOpen: {},
  toasts: [],
  confirmState: null,

  init: async () => {
    if (initialized) return
    initialized = true

    const app = await window.api.getState()
    set({ app, ready: true })
    void get().refreshAuth()

    window.api.onState((next) => set({ app: next }))

    // OS 알림 클릭 등으로 main 이 요청한 workspace 선택.
    window.api.onSelectWorkspace((workspaceId) => {
      void get().selectWorkspace(workspaceId)
    })

    // 창이 다시 활성화되면 인증 상태를 갱신한다(Terminal 로그인 완료 자동 반영).
    window.addEventListener('focus', () => void get().refreshAuth())

    window.api.onChat(({ workspaceId, event }: ChatEnvelope) => {
      const { transcripts } = get()
      const items = transcripts[workspaceId] ?? []

      if (event.type === 'item') {
        set({ transcripts: { ...transcripts, [workspaceId]: upsertItem(items, event.item) } })

        // 응답 완료: 알림음 + 미확인 표시 + git/PR 상태 새로고침
        // (에이전트가 방금 커밋·PR 생성을 했을 수 있으므로 칩이 곧바로 반영되도록).
        if (event.item.type === 'result') {
          const s = get()
          if (s.app?.settings.soundOnComplete) playNotification()
          if (workspaceId !== s.selectedWorkspaceId) {
            set({ unread: { ...s.unread, [workspaceId]: true } })
          }
          void s.refreshGit(workspaceId)
          void s.refreshPr(workspaceId)
        }
      } else if (event.type === 'delta') {
        const idx = items.findIndex((i) => i.id === event.id)
        let next: ChatItem[]
        if (idx === -1) {
          next = [
            ...items,
            { id: event.id, type: event.itemType, text: event.text, ts: Date.now(), streaming: true }
          ]
        } else {
          const target = items[idx]
          next = items.slice()
          next[idx] = { ...target, text: (target as { text: string }).text + event.text } as ChatItem
        }
        set({ transcripts: { ...transcripts, [workspaceId]: next } })
      } else if (event.type === 'status' || event.type === 'session') {
        patchWorkspace(set, get, workspaceId, (w) => {
          if (event.type === 'status') {
            w.status = event.status
          } else {
            w.sessionId = event.sessionId
            if (event.model) w.lastModel = event.model
          }
        })
        // 백그라운드 세션이 에러로 끝나면 미확인으로 표시(빨간 점 + 점프 대상).
        if (event.type === 'status' && event.status === 'error') {
          const s = get()
          if (workspaceId !== s.selectedWorkspaceId) {
            set({ unread: { ...s.unread, [workspaceId]: true } })
          }
        }
      }
    })

    window.api.onPermission((req: PermissionRequest) => {
      set({ permissions: [...get().permissions, req] })
    })

    window.api.onScriptOutput(({ workspaceId, kind, chunk }) => {
      const key = scriptKey(workspaceId, kind)
      const out = get().scriptOutput
      set({ scriptOutput: { ...out, [key]: (out[key] ?? '') + chunk } })
    })

    window.api.onScriptExit(({ workspaceId, kind, code }) => {
      const key = scriptKey(workspaceId, kind)
      const out = get().scriptOutput
      set({
        scriptOutput: {
          ...out,
          [key]: (out[key] ?? '') + `\n[ditto] exited (code ${code ?? '?'})\n`
        }
      })
      void get().refreshScriptStatus(workspaceId)
    })
  },

  selectWorkspace: async (id) => {
    // 선택 시 미확인 표시 해제.
    set((s) => {
      if (!id || !s.unread[id]) return { selectedWorkspaceId: id }
      const unread = { ...s.unread }
      delete unread[id]
      return { selectedWorkspaceId: id, unread }
    })
    if (!id) return

    if (!get().loadedTranscripts[id]) {
      const history = await window.api.chat.getHistory(id)
      set((s) => ({
        transcripts: { ...s.transcripts, [id]: history },
        loadedTranscripts: { ...s.loadedTranscripts, [id]: true }
      }))
    }
    void get().refreshGit(id)
    void get().refreshPr(id)
    void get().refreshScriptStatus(id)
  },

  refreshGit: async (workspaceId) => {
    const status = await window.api.git.status(workspaceId)
    set((s) => ({ gitStatus: { ...s.gitStatus, [workspaceId]: status } }))
  },

  refreshPr: async (workspaceId) => {
    const status = await window.api.pr.status(workspaceId)
    set((s) => ({ prStatus: { ...s.prStatus, [workspaceId]: status } }))
  },

  refreshScriptStatus: async (workspaceId) => {
    const status = await window.api.script.getStatus(workspaceId)
    set((s) => ({ scriptStatus: { ...s.scriptStatus, [workspaceId]: status } }))
  },

  refreshAuth: async () => {
    try {
      const status = await window.api.auth.getStatus()
      set({ authStatus: status })
    } catch {
      set({ authStatus: { claude: { loggedIn: false }, github: { loggedIn: false } } })
    }
  },

  dismissPermission: (requestId) => {
    set({ permissions: get().permissions.filter((p) => p.requestId !== requestId) })
  },

  /** 미확인 세션 중 선택 후보 하나(사이드바 순서 기준 첫 항목). */
  nextUnreadId: () => {
    const s = get()
    const order = s.app?.workspaces ?? []
    const found = order.find((w) => s.unread[w.id] && w.id !== s.selectedWorkspaceId)
    return found?.id ?? null
  },

  /** 권한 대기 중인 다른 workspace 중 사이드바 순서상 첫 항목. */
  nextPendingPermissionId: () => {
    const s = get()
    const waiting = new Set(s.permissions.map((p) => p.workspaceId))
    const order = s.app?.workspaces ?? []
    const found = order.find((w) => waiting.has(w.id) && w.id !== s.selectedWorkspaceId)
    return found?.id ?? null
  },

  setDraft: (workspaceId, text) => set((s) => ({ drafts: { ...s.drafts, [workspaceId]: text } })),

  setScrollPosition: (workspaceId, top) =>
    set((s) => ({ scrollPositions: { ...s.scrollPositions, [workspaceId]: top } })),

  setScriptPanelOpen: (workspaceId, open) =>
    set((s) => ({ scriptPanelOpen: { ...s.scriptPanelOpen, [workspaceId]: open } })),

  pushToast: (kind, message) => {
    const id = `toast:${++toastSeq}`
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    // info/success 는 자동으로 사라지고, error 는 사용자가 닫을 때까지 둔다.
    if (kind !== 'error') {
      setTimeout(() => get().dismissToast(id), 4000)
    }
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      set({ confirmState: { ...opts, resolve } })
    }),

  resolveConfirm: (ok) => {
    const cs = get().confirmState
    if (cs) cs.resolve(ok)
    set({ confirmState: null })
  }
}))

function patchWorkspace(
  set: (fn: (s: UIState) => Partial<UIState>) => void,
  get: () => UIState,
  workspaceId: string,
  mutate: (w: Workspace) => void
): void {
  const app = get().app
  if (!app) return
  const workspaces = app.workspaces.map((w) => {
    if (w.id !== workspaceId) return w
    const copy = { ...w }
    mutate(copy)
    return copy
  })
  set(() => ({ app: { ...app, workspaces } }))
}
