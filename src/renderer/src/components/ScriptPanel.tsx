import { useState } from 'react'
import { Play, Square, X } from 'lucide-react'
import { useStore, scriptKey } from '../store'
import type { ScriptKind } from '@shared/types'

export default function ScriptPanel({
  workspaceId,
  onClose
}: {
  workspaceId: string
  onClose: () => void
}): React.JSX.Element {
  const app = useStore((s) => s.app)!
  const ws = app.workspaces.find((w) => w.id === workspaceId)!
  const repo = app.repos.find((r) => r.id === ws.repoId)!
  const output = useStore((s) => s.scriptOutput)
  const statuses = useStore((s) => s.scriptStatus[workspaceId]) ?? []
  const refreshStatus = useStore((s) => s.refreshScriptStatus)
  const [tab, setTab] = useState<ScriptKind>('dev')

  const command = tab === 'setup' ? repo.setupScript : repo.devScript
  const status = statuses.find((s) => s.kind === tab)
  const running = status?.state === 'running'
  const out = output[scriptKey(workspaceId, tab)] ?? ''

  const run = (): void => {
    void window.api.script.run(workspaceId, tab).then(() => refreshStatus(workspaceId))
  }
  const stop = (): void => {
    void window.api.script.stop(workspaceId, tab).then(() => refreshStatus(workspaceId))
  }

  return (
    <div className="shrink-0 h-64 border-t border-[var(--surface-2)] bg-[var(--bg-2)] flex flex-col">
      <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--surface-2)]">
        {(['dev', 'setup'] as ScriptKind[]).map((kind) => {
          const active = tab === kind
          const isRunning = statuses.find((s) => s.kind === kind)?.state === 'running'
          return (
            <button
              key={kind}
              onClick={() => setTab(kind)}
              className={
                'flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md ' +
                (active ? 'bg-[var(--surface-2)] text-neutral-100' : 'text-neutral-400 hover:text-neutral-200')
              }
            >
              {kind === 'dev' ? 'Dev server' : 'Setup'}
              {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
            </button>
          )
        })}

        <div className="flex-1" />

        {command.trim() ? (
          running ? (
            <button
              onClick={stop}
              className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md text-red-400 hover:bg-red-500/15"
            >
              <Square size={12} fill="currentColor" /> Stop
            </button>
          ) : (
            <button
              onClick={run}
              className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md text-emerald-400 hover:bg-emerald-500/15"
            >
              <Play size={12} fill="currentColor" /> Run
            </button>
          )
        ) : (
          <span className="text-[11px] text-neutral-600">Set a command in repo settings</span>
        )}

        <button
          onClick={onClose}
          className="h-6 w-6 grid place-items-center rounded-md text-neutral-500 hover:bg-[var(--surface-2)] hover:text-neutral-200"
        >
          <X size={14} />
        </button>
      </div>

      {command.trim() && (
        <div className="px-3 pt-1.5 text-[11px] text-neutral-600 font-mono truncate">
          $ {command}
        </div>
      )}
      <pre className="flex-1 overflow-auto px-3 py-2 text-[11.5px] font-mono text-neutral-400 whitespace-pre-wrap">
        {out || (command.trim() ? 'No output yet.' : '')}
      </pre>
    </div>
  )
}
