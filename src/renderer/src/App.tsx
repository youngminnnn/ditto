import { useEffect, useState } from 'react'
import { useStore } from './store'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import EmptyState from './components/EmptyState'
import SettingsModal from './components/SettingsModal'
import NewWorkspaceModal from './components/NewWorkspaceModal'
import RepoConfigModal from './components/RepoConfigModal'

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

  if (!ready || !app) {
    return <div className="h-full grid place-items-center text-neutral-500">로딩 중…</div>
  }

  const selected = app.workspaces.find((w) => w.id === selectedId) ?? null

  return (
    <div className="h-full flex flex-col bg-[#0b0c0e]">
      <TitleBar onOpenSettings={() => setShowSettings(true)} />
      <div className="flex-1 flex min-h-0">
        <Sidebar onNewWorkspace={setNewWsRepoId} onConfigRepo={setConfigRepoId} />
        <div className="flex-1 min-w-0 border-l border-[#1c1f25]">
          {selected ? <ChatView key={selected.id} workspace={selected} /> : <EmptyState />}
        </div>
      </div>

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
