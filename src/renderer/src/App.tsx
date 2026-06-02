import { useEffect, useState } from 'react'
import { useStore } from './store'
import { nextPermissionMode } from './lib/permission'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import EmptyState from './components/EmptyState'
import SettingsModal from './components/SettingsModal'
import NewWorkspaceModal from './components/NewWorkspaceModal'
import RepoConfigModal from './components/RepoConfigModal'
import OnboardingModal from './components/OnboardingModal'

export default function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const app = useStore((s) => s.app)
  const selectedId = useStore((s) => s.selectedWorkspaceId)

  const [showSettings, setShowSettings] = useState(false)
  const [newWsRepoId, setNewWsRepoId] = useState<string | null>(null)
  const [configRepoId, setConfigRepoId] = useState<string | null>(null)

  useEffect(() => {
    void init()
  }, [init])

  const anyModalOpen = showSettings || newWsRepoId !== null || configRepoId !== null

  // Claude Code 처럼 Shift+Tab 으로 선택된 workspace 의 권한 모드를 순환한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !e.shiftKey || anyModalOpen) return
      const st = useStore.getState()
      const ws = st.app?.workspaces.find((w) => w.id === st.selectedWorkspaceId)
      if (!ws) return
      e.preventDefault()
      void window.api.workspace.setPermissionMode(ws.id, nextPermissionMode(ws.permissionMode))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anyModalOpen])

  if (!ready || !app) {
    return <div className="h-full grid place-items-center text-neutral-500">Loading…</div>
  }

  const selected = app.workspaces.find((w) => w.id === selectedId) ?? null

  // 새 workspace 만들기: 수동 설정이면 모달, 아니면 즉시 자동 생성.
  const handleNewWorkspace = async (repoId: string): Promise<void> => {
    if (app.settings.manualWorkspaceSetup) {
      setNewWsRepoId(repoId)
      return
    }
    const res = await window.api.workspace.create({ repoId })
    if (res.error) window.alert(res.error)
    else if (res.workspaceId) void useStore.getState().selectWorkspace(res.workspaceId)
  }

  return (
    <div className="h-full flex flex-col bg-[#0b0c0e]">
      <TitleBar onOpenSettings={() => setShowSettings(true)} />
      <div className="flex-1 flex min-h-0">
        <Sidebar onNewWorkspace={handleNewWorkspace} onConfigRepo={setConfigRepoId} />
        <div className="flex-1 min-w-0 border-l border-[#1c1f25]">
          {selected ? <ChatView key={selected.id} workspace={selected} /> : <EmptyState />}
        </div>
      </div>

      {!app.settings.onboarded && (
        <OnboardingModal onDone={() => void window.api.settings.update({ onboarded: true })} />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {newWsRepoId && (
        <NewWorkspaceModal repoId={newWsRepoId} onClose={() => setNewWsRepoId(null)} />
      )}
      {configRepoId && (
        <RepoConfigModal repoId={configRepoId} onClose={() => setConfigRepoId(null)} />
      )}
    </div>
  )
}
