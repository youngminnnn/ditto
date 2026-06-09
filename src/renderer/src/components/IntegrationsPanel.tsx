import { useEffect, useRef } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { ClaudeMark, GithubMark } from './BrandIcons'

export default function IntegrationsPanel(): React.JSX.Element {
  const auth = useStore((s) => s.authStatus)
  const refreshAuth = useStore((s) => s.refreshAuth)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void refreshAuth()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [refreshAuth])

  // 로그인은 Terminal 에서 진행되므로, 트리거 후 인증 상태를 폴링해 자동 반영한다.
  // 상태가 바뀌면(로그인/로그아웃 감지) 즉시 멈추고, 최대 60초까지만 시도한다.
  const pollUntilChange = (): void => {
    if (pollRef.current) clearInterval(pollRef.current)
    const before = JSON.stringify(useStore.getState().authStatus)
    let ticks = 0
    const stop = (): void => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
    pollRef.current = setInterval(() => {
      ticks++
      void refreshAuth()
      const changed = JSON.stringify(useStore.getState().authStatus) !== before
      if (changed || ticks >= 20) stop()
    }, 3000)
  }

  const claude = auth?.claude
  const github = auth?.github

  return (
    <div className="space-y-3">
      <IntegrationRow
        name="Claude Code"
        icon={<ClaudeMark size={18} />}
        loading={!auth}
        installed={!!claude?.installed}
        installUrl="https://claude.com/claude-code"
        connected={!!claude?.loggedIn}
        detail={
          !claude?.installed
            ? 'Not installed — install Claude Code to continue'
            : claude.loggedIn
              ? [claude.email, claude.orgName].filter(Boolean).join(' · ') || 'Signed in'
              : 'Sign in to run Claude Code agents'
        }
        onConnect={() => {
          void window.api.auth.claudeLogin()
          pollUntilChange()
        }}
        onDisconnect={() => void window.api.auth.claudeLogout().then(() => refreshAuth())}
      />

      <IntegrationRow
        name="GitHub"
        icon={<GithubMark size={17} />}
        loading={!auth}
        installed={!!github?.installed}
        installUrl="https://cli.github.com"
        connected={!!github?.loggedIn}
        detail={
          !github?.installed
            ? 'Not installed — the GitHub CLI (gh) is optional, for PRs'
            : github.loggedIn
              ? `@${github.account ?? '?'}${github.protocol ? ` · ${github.protocol}` : ''}`
              : 'Connect to push branches and open PRs'
        }
        onConnect={() => {
          void window.api.auth.githubLogin()
          pollUntilChange()
        }}
        onDisconnect={() => {
          void window.api.auth.githubLogout()
          pollUntilChange()
        }}
      />

      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-neutral-500 leading-relaxed pr-3">
          Sign-in opens your Terminal to finish the flow. Status refreshes automatically — or click Refresh.
        </p>
        <button
          onClick={() => void refreshAuth()}
          className="shrink-0 flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg text-neutral-300 hover:bg-[var(--surface-2)]"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
    </div>
  )
}

function IntegrationRow({
  name,
  icon,
  detail,
  connected,
  loading,
  installed,
  installUrl,
  onConnect,
  onDisconnect
}: {
  name: string
  icon: React.ReactNode
  detail: string
  connected: boolean
  loading: boolean
  installed: boolean
  installUrl: string
  onConnect: () => void
  onDisconnect: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 bg-[var(--bg-2)] border border-[var(--border)] rounded-lg px-3.5 py-3">
      <div className="h-8 w-8 grid place-items-center rounded-lg bg-[var(--surface-2)] text-neutral-300 shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-100">
          {name}
          {connected && <Check size={13} className="text-emerald-400" />}
        </div>
        <div className="text-[11.5px] text-neutral-500 truncate">{detail}</div>
      </div>
      {loading ? (
        <Loader2 size={15} className="text-neutral-500 animate-spin" />
      ) : !installed ? (
        <button
          onClick={() => void window.api.openExternal(installUrl)}
          className="text-[12px] px-3 py-1.5 rounded-lg bg-[var(--surface-2)] text-neutral-200 font-medium hover:bg-[var(--border)]"
        >
          Install
        </button>
      ) : connected ? (
        <div className="flex gap-1.5">
          <button
            onClick={onConnect}
            className="text-[12px] px-2.5 py-1.5 rounded-lg text-neutral-300 hover:bg-[var(--surface-2)]"
          >
            Reconnect
          </button>
          <button
            onClick={onDisconnect}
            className="text-[12px] px-2.5 py-1.5 rounded-lg text-neutral-400 hover:bg-red-500/15 hover:text-red-400"
          >
            Sign out
          </button>
        </div>
      ) : (
        <button
          onClick={onConnect}
          className="text-[12px] px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500"
        >
          Sign in
        </button>
      )}
    </div>
  )
}
