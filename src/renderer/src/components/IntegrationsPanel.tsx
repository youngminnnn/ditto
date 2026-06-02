import { useEffect } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '../store'

export default function IntegrationsPanel(): React.JSX.Element {
  const auth = useStore((s) => s.authStatus)
  const refreshAuth = useStore((s) => s.refreshAuth)

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  const claude = auth?.claude
  const github = auth?.github

  return (
    <div className="space-y-3">
      <IntegrationRow
        name="Claude Code"
        logo="✶"
        loading={!auth}
        connected={!!claude?.loggedIn}
        detail={
          claude?.loggedIn
            ? [claude.email, claude.orgName].filter(Boolean).join(' · ') || 'Signed in'
            : 'Sign in to run Claude Code agents'
        }
        onConnect={() => void window.api.auth.claudeLogin()}
        onDisconnect={() => void window.api.auth.claudeLogout().then(() => refreshAuth())}
      />

      <IntegrationRow
        name="GitHub"
        logo=""
        loading={!auth}
        connected={!!github?.loggedIn}
        detail={
          github?.loggedIn
            ? `@${github.account ?? '?'}${github.protocol ? ` · ${github.protocol}` : ''}`
            : 'Connect to push branches and open PRs'
        }
        onConnect={() => void window.api.auth.githubLogin()}
        onDisconnect={() => void window.api.auth.githubLogout()}
      />

      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-neutral-600 leading-relaxed pr-3">
          Sign-in opens your Terminal to finish the flow. Click Refresh when done.
        </p>
        <button
          onClick={() => void refreshAuth()}
          className="shrink-0 flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg text-neutral-300 hover:bg-[#1c1f25]"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
    </div>
  )
}

function IntegrationRow({
  name,
  logo,
  detail,
  connected,
  loading,
  onConnect,
  onDisconnect
}: {
  name: string
  logo: string
  detail: string
  connected: boolean
  loading: boolean
  onConnect: () => void
  onDisconnect: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 bg-[#0d0e11] border border-[#23262d] rounded-lg px-3.5 py-3">
      <div className="h-8 w-8 grid place-items-center rounded-lg bg-[#1c1f25] text-neutral-300 text-base shrink-0">
        {logo || name[0]}
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
      ) : connected ? (
        <div className="flex gap-1.5">
          <button
            onClick={onConnect}
            className="text-[12px] px-2.5 py-1.5 rounded-lg text-neutral-300 hover:bg-[#1c1f25]"
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
