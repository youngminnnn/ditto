import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { CURRENT_TERMS_VERSION } from '@shared/types'
import { useStore } from './store'
import { nextPermissionMode } from './lib/permission'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import WorkArea from './components/WorkArea'
import Splitter from './components/Splitter'
import EmptyState from './components/EmptyState'
import SettingsModal from './components/SettingsModal'
import NewWorkspaceModal from './components/NewWorkspaceModal'
import RepoConfigModal from './components/RepoConfigModal'
import OnboardingModal from './components/OnboardingModal'
import Toaster from './components/Toaster'
import ConfirmDialog from './components/ConfirmDialog'
import Logo from './components/Logo'

export default function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const app = useStore((s) => s.app)
  const selectedId = useStore((s) => s.selectedWorkspaceId)
  const authStatus = useStore((s) => s.authStatus)
  const rightWidth = useStore((s) => s.rightWidth)
  const setRightWidth = useStore((s) => s.setRightWidth)
  const rightBase = useRef(rightWidth)

  const [showSettings, setShowSettings] = useState(false)
  const [newWsRepoId, setNewWsRepoId] = useState<string | null>(null)
  const [configRepoId, setConfigRepoId] = useState<string | null>(null)

  useEffect(() => {
    void init()
  }, [init])

  // 온보딩(약관 동의·계정 연결) 모달이 떠 있는 동안에는 전역 단축키도 막아, 동의 전 앱 조작을 차단한다.
  const onboardingOpen =
    !!app && (!app.settings.onboarded || app.settings.acceptedTermsVersion !== CURRENT_TERMS_VERSION)
  const anyModalOpen =
    showSettings || newWsRepoId !== null || configRepoId !== null || onboardingOpen

  // 키보드: ⇧⇥ 권한 모드 순환, ⌘1–9 워크스페이스 선택, ⌘[ / ⌘] 이전/다음.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useStore.getState()
      // 모달이나 confirm 대화상자가 떠 있으면 전역 단축키를 막는다.
      if (anyModalOpen || st.confirmState) return

      if (e.key === 'Tab' && e.shiftKey) {
        const ws = st.app?.workspaces.find((w) => w.id === st.selectedWorkspaceId)
        if (!ws) return
        e.preventDefault()
        void window.api.workspace.setPermissionMode(ws.id, nextPermissionMode(ws.permissionMode))
        return
      }

      if (!e.metaKey) return
      const list = (st.app?.workspaces ?? []).filter((w) => !w.archived)
      if (!list.length) return

      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1
        if (idx < list.length) {
          e.preventDefault()
          void st.selectWorkspace(list[idx].id)
        }
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        const cur = list.findIndex((w) => w.id === st.selectedWorkspaceId)
        const delta = e.key === ']' ? 1 : -1
        const next = cur < 0 ? 0 : (cur + delta + list.length) % list.length
        void st.selectWorkspace(list[next].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anyModalOpen])

  if (!ready || !app) {
    return (
      <div className="h-full grid place-items-center bg-[#0b0c0e]">
        <div className="flex flex-col items-center gap-3 text-neutral-500">
          <Logo size={40} />
          <span className="text-[12px]">Loading…</span>
        </div>
      </div>
    )
  }

  const selected = app.workspaces.find((w) => w.id === selectedId && !w.archived) ?? null
  const claudeMissing = app.settings.onboarded && authStatus !== null && !authStatus.claude.loggedIn

  // 약관 미동의(또는 버전 불일치)면 동의 단계부터, 계정 연결이 안 끝났으면 연동 단계를 띄운다.
  const needsConsent = app.settings.acceptedTermsVersion !== CURRENT_TERMS_VERSION
  const needsOnboarding = !app.settings.onboarded

  // 새 workspace 만들기: 수동 설정이면 모달, 아니면 즉시 자동 생성.
  // 자동 생성은 사이드바에 스피너 행을 바로 띄우고 worktree 준비는 백그라운드로 진행한다.
  const handleNewWorkspace = (repoId: string): void => {
    if (app.settings.manualWorkspaceSetup) {
      setNewWsRepoId(repoId)
      return
    }
    void useStore.getState().createWorkspace(repoId)
  }

  return (
    <div className="h-full flex flex-col bg-[#0b0c0e]">
      <TitleBar onOpenSettings={() => setShowSettings(true)} />

      {claudeMissing && (
        <button
          onClick={() => setShowSettings(true)}
          className="no-drag shrink-0 flex items-center justify-center gap-2 h-8 bg-amber-500/10 border-b border-amber-500/25 text-[12px] text-amber-300 hover:bg-amber-500/15"
        >
          <AlertTriangle size={13} />
          You&rsquo;re not signed in to Claude Code. Agents won&rsquo;t run until you connect — click to open Settings.
        </button>
      )}

      <div className="flex-1 flex min-h-0">
        <Sidebar onNewWorkspace={handleNewWorkspace} onConfigRepo={setConfigRepoId} />
        <div className="flex-1 min-w-0 border-l border-[#1c1f25] flex">
          {selected ? (
            <>
              <div className="flex-1 min-w-0">
                <ChatView key={selected.id} workspace={selected} />
              </div>
              <Splitter
                axis="x"
                onStart={() => (rightBase.current = useStore.getState().rightWidth)}
                // 분할바를 오른쪽으로 끌면(dx>0) 우측 패널이 좁아진다.
                onDelta={(dx) => setRightWidth(rightBase.current - dx)}
              />
              <div
                style={{ width: rightWidth }}
                className="shrink-0 border-l border-[#1c1f25] min-w-0"
              >
                <WorkArea key={selected.id} workspace={selected} />
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>

      {(needsConsent || needsOnboarding) && (
        <OnboardingModal needsConsent={needsConsent} needsOnboarding={needsOnboarding} />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {newWsRepoId && <NewWorkspaceModal repoId={newWsRepoId} onClose={() => setNewWsRepoId(null)} />}
      {configRepoId && <RepoConfigModal repoId={configRepoId} onClose={() => setConfigRepoId(null)} />}

      <Toaster />
      <ConfirmDialog />
    </div>
  )
}
