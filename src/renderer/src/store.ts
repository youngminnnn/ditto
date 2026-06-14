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

/** 컨텍스트 윈도 사용량 스냅샷(마지막 턴). percentage 는 0~1. */
export interface ContextUsage {
  usedTokens: number
  maxTokens: number
  percentage: number
}

export type ToastKind = 'info' | 'success' | 'error'
export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

/** 생성 중(아직 worktree 준비 전)인 workspace 의 사이드바 자리표시 행. 영속되지 않는 렌더러 전용 상태. */
export interface PendingWorkspace {
  id: string
  repoId: string
  /** 사용자가 입력한 이름. 자동 생성 모드면 빈 문자열(행에는 "Creating…" 만 표시). */
  name: string
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
let pendingSeq = 0

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
  /** workspace 별 컨텍스트 윈도 사용량(마지막 턴 기준). 입력창 사용량 미터용. */
  contextUsage: Record<string, ContextUsage>
  /** workspace 별 대화 압축 진행 여부(자동/수동 /compact 진행 중이면 true). */
  compacting: Record<string, boolean>
  /** 응답이 완료됐지만 사용자가 아직 보지 않은 workspace. */
  unread: Record<string, boolean>
  /** workspace 전환에도 살아남아야 하는 입력창 초안. */
  drafts: Record<string, string>
  /** workspace 별 대화 스크롤 위치(복원용). */
  scrollPositions: Record<string, number>
  /** workspace 별 스크립트 패널 열림 상태. */
  scriptPanelOpen: Record<string, boolean>
  /** 우측 작업 패널(파일/변경/체크 + 터미널)의 너비(px). 세로 분할 드래그로 조절. */
  rightWidth: number
  /** 우측 작업 패널 표시 여부. 숨기면 대화 영역이 전체 폭을 차지한다. */
  rightPanelOpen: boolean
  /** 우하단 터미널이 우측 컬럼 높이에서 차지하는 비율(0~1). 기본 0.5. 가로 분할 드래그로 조절. */
  terminalRatio: number
  toasts: Toast[]
  confirmState: ConfirmState | null
  /** 생성 중인 workspace 의 자리표시 행(repoId 로 사이드바에 배치). */
  pending: PendingWorkspace[]

  init: () => Promise<void>
  /** worktree 생성을 시작하고, 완료될 때까지 사이드바에 스피너 행을 즉시 띄운다. */
  createWorkspace: (
    repoId: string,
    args?: { name?: string; baseBranch?: string },
    displayName?: string
  ) => Promise<void>
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
  setRightWidth: (px: number) => void
  toggleRightPanel: () => void
  setTerminalRatio: (ratio: number) => void
  pushToast: (kind: ToastKind, message: string) => void
  dismissToast: (id: string) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  resolveConfirm: (ok: boolean) => void
}

let initialized = false

// 창 포커스 상태(완료를 미확인으로 잡을지 판단용). DOM 의 document.hasFocus() 는 Dock 클릭·앱
// 전환 시 신뢰할 수 없어, main 의 권위 있는 focus/blur 이벤트로 갱신한다. 시작 시 포커스 가정.
let windowFocused = true

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
  contextUsage: {},
  compacting: {},
  unread: {},
  drafts: {},
  scrollPositions: {},
  scriptPanelOpen: {},
  rightWidth: 460,
  rightPanelOpen: true,
  terminalRatio: 0.5,
  toasts: [],
  confirmState: null,
  pending: [],

  init: async () => {
    if (initialized) return
    initialized = true

    const app = await window.api.getState()
    set({ app, ready: true })
    void get().refreshAuth()

    window.api.onState((next) => {
      // 삭제·아카이브된 workspace 의 미확인 표시가 Dock 배지에 남지 않도록 정리한다
      // (배지 카운트는 unread 변화에만 반응하므로, 사라진 workspace 의 항목을 여기서 제거해야 0 으로 떨어진다).
      set((s) => {
        const live = new Set(next.workspaces.filter((w) => !w.archived).map((w) => w.id))
        const stale = Object.keys(s.unread).filter((id) => s.unread[id] && !live.has(id))
        if (!stale.length) return { app: next }
        const unread = { ...s.unread }
        for (const id of stale) delete unread[id]
        return { app: next, unread }
      })
    })

    // OS 알림 클릭 등으로 main 이 요청한 workspace 선택.
    window.api.onSelectWorkspace((workspaceId) => {
      void get().selectWorkspace(workspaceId)
    })

    // 지금 보고 있는 workspace 의 미확인 표시를 해제한다(사용자가 막 들여다봤으므로).
    const clearSelectedUnread = (): void => {
      const s = get()
      const sel = s.selectedWorkspaceId
      if (sel && s.unread[sel]) {
        const unread = { ...s.unread }
        delete unread[sel]
        set({ unread })
      }
    }

    // 창이 다시 활성화되면 인증 상태를 갱신하고(Terminal 로그인 완료 자동 반영) 미확인 표시를 해제한다.
    // main 의 'focus' 이벤트가 신뢰 가능한 트리거이고, DOM 의 window 'focus' 는 보조로 함께 둔다
    // (Dock 클릭·앱 전환 시 DOM 이벤트가 누락되어 배지가 안 사라지던 문제를 막는다).
    window.api.onWindowFocus(() => {
      windowFocused = true
      clearSelectedUnread()
    })
    window.api.onWindowBlur(() => {
      windowFocused = false
    })
    window.addEventListener('focus', () => {
      windowFocused = true
      void get().refreshAuth()
      clearSelectedUnread()
    })
    window.addEventListener('blur', () => {
      windowFocused = false
    })

    // macOS Dock 빨간 배지 = "내 주의가 필요한" workspace 수. 미확인 완료(unread)뿐 아니라
    // 입력 대기(권한 요청·AskUserQuestion 질문)도 포함한다 — auto 모드 백그라운드 세션이
    // 질문에서 멈추면 result 가 없어 unread 가 안 잡히므로, 권한 대기를 세지 않으면 작업이
    // 사실상 끝났는데도 배지가 안 떴다. workspace 단위로 중복 없이 센다(완료+질문이 겹쳐도 1).
    // 선택/열람(unread 해제)·응답(permissions 제거) 시 자동으로 감소한다.
    const refreshBadge = (state: UIState): void => {
      const needsAttention = new Set<string>()
      for (const [id, on] of Object.entries(state.unread)) if (on) needsAttention.add(id)
      for (const p of state.permissions) needsAttention.add(p.workspaceId)
      void window.api.app.setBadgeCount(needsAttention.size)
    }
    useStore.subscribe((state, prev) => {
      if (state.unread !== prev.unread || state.permissions !== prev.permissions) {
        refreshBadge(state)
      }
    })

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
          // 다른 workspace 의 완료, 또는 창이 비활성일 때 본 workspace 의 완료도 미확인으로 표시
          // (자리를 비운 사이 끝난 작업을 Dock 배지·점프 버튼으로 알린다).
          if (workspaceId !== s.selectedWorkspaceId || !windowFocused) {
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
      } else if (event.type === 'context') {
        set({
          contextUsage: {
            ...get().contextUsage,
            [workspaceId]: {
              usedTokens: event.usedTokens,
              maxTokens: event.maxTokens,
              percentage: event.percentage
            }
          }
        })
      } else if (event.type === 'compacting') {
        set({ compacting: { ...get().compacting, [workspaceId]: event.active } })
      }
    })

    window.api.onPermission((req: PermissionRequest) => {
      set({ permissions: [...get().permissions, req] })
    })

    window.api.onPermissionCancel((requestId: string) => {
      set({ permissions: get().permissions.filter((p) => p.requestId !== requestId) })
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

  createWorkspace: async (repoId, args, displayName) => {
    // worktree 체크아웃(git)은 큰 리포에서 수 초가 걸리므로, 먼저 자리표시 행을 띄워
    // 즉각적인 피드백을 주고 git 은 그동안 백그라운드로 진행한다. 완료 시 실제 행으로 교체된다.
    const placeholderId = `pending:${++pendingSeq}`
    set((s) => ({ pending: [...s.pending, { id: placeholderId, repoId, name: displayName ?? '' }] }))

    let res: { workspaceId?: string; name?: string; branch?: string; error?: string }
    try {
      res = await window.api.workspace.create({ repoId, ...args })
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) }
    }

    set((s) => ({ pending: s.pending.filter((p) => p.id !== placeholderId) }))

    if (res.error) {
      get().pushToast('error', res.error)
      return
    }
    if (res.workspaceId) {
      void get().selectWorkspace(res.workspaceId)
      if (res.name && res.branch) {
        get().pushToast('success', `Created workspace “${res.name}” on ${res.branch}`)
      }
    }
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
      set({
        authStatus: {
          claude: { installed: false, loggedIn: false },
          github: { installed: false, loggedIn: false }
        }
      })
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

  // 우측 패널 너비 — 대화/터미널이 너무 좁아지지 않도록 양끝을 클램프한다.
  setRightWidth: (px) => set({ rightWidth: Math.max(320, Math.min(900, Math.round(px))) }),

  // 우측 패널 표시 토글 — 숨기면 대화가 전체 폭을 쓰고, 다시 켜면 마지막 너비로 복귀한다.
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  // 터미널 비율 — 패널/터미널 어느 쪽도 사라지지 않도록 0.15~0.85 로 클램프한다.
  setTerminalRatio: (ratio) => set({ terminalRatio: Math.max(0.15, Math.min(0.85, ratio)) }),

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
