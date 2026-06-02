import { create } from 'zustand'
import type {
  AppState,
  AuthStatus,
  ChatEnvelope,
  ChatItem,
  GitStatus,
  PermissionRequest,
  ScriptKind,
  ScriptStatus,
  Workspace
} from '@shared/types'

export const scriptKey = (workspaceId: string, kind: ScriptKind): string => `${workspaceId}:${kind}`

interface UIState {
  ready: boolean
  app: AppState | null
  selectedWorkspaceId: string | null
  transcripts: Record<string, ChatItem[]>
  loadedTranscripts: Record<string, boolean>
  scriptOutput: Record<string, string>
  scriptStatus: Record<string, ScriptStatus[]>
  gitStatus: Record<string, GitStatus | null>
  permissions: PermissionRequest[]
  authStatus: AuthStatus | null

  init: () => Promise<void>
  selectWorkspace: (id: string | null) => Promise<void>
  refreshGit: (workspaceId: string) => Promise<void>
  refreshScriptStatus: (workspaceId: string) => Promise<void>
  refreshAuth: () => Promise<void>
  dismissPermission: (requestId: string) => void
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
  permissions: [],
  authStatus: null,

  init: async () => {
    if (initialized) return
    initialized = true

    const app = await window.api.getState()
    set({ app, ready: true })
    void get().refreshAuth()

    window.api.onState((next) => set({ app: next }))

    window.api.onChat(({ workspaceId, event }: ChatEnvelope) => {
      const { transcripts } = get()
      const items = transcripts[workspaceId] ?? []

      if (event.type === 'item') {
        set({ transcripts: { ...transcripts, [workspaceId]: upsertItem(items, event.item) } })
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
          if (event.type === 'status') w.status = event.status
          else w.sessionId = event.sessionId
        })
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
    set({ selectedWorkspaceId: id })
    if (!id) return

    if (!get().loadedTranscripts[id]) {
      const history = await window.api.chat.getHistory(id)
      set((s) => ({
        transcripts: { ...s.transcripts, [id]: history },
        loadedTranscripts: { ...s.loadedTranscripts, [id]: true }
      }))
    }
    void get().refreshGit(id)
    void get().refreshScriptStatus(id)
  },

  refreshGit: async (workspaceId) => {
    const status = await window.api.git.status(workspaceId)
    set((s) => ({ gitStatus: { ...s.gitStatus, [workspaceId]: status } }))
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
