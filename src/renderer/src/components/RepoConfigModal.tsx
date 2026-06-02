import { useState } from 'react'
import { useStore } from '../store'
import Modal, { inputClass, labelClass, primaryBtn, ghostBtn } from './Modal'

export default function RepoConfigModal({
  repoId,
  onClose
}: {
  repoId: string
  onClose: () => void
}): React.JSX.Element {
  const app = useStore((s) => s.app)!
  const repo = app.repos.find((r) => r.id === repoId)!
  const [name, setName] = useState(repo.name)
  const [setupScript, setSetup] = useState(repo.setupScript)
  const [devScript, setDev] = useState(repo.devScript)

  const save = async (): Promise<void> => {
    await window.api.repo.update(repoId, { name: name.trim() || repo.name, setupScript, devScript })
    onClose()
  }

  const removeRepo = async (): Promise<void> => {
    const wsCount = app.workspaces.filter((w) => w.repoId === repoId).length
    const ok = window.confirm(
      `Remove repository "${repo.name}"?` +
        (wsCount > 0
          ? `\n${wsCount} workspace(s) and their worktree directories will also be removed. (Branches are kept.)`
          : '')
    )
    if (!ok) return
    await window.api.repo.remove(repoId)
    onClose()
  }

  return (
    <Modal
      title={`Repository settings · ${repo.name}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className={ghostBtn + ' mr-auto text-red-400 hover:bg-red-500/15'} onClick={removeRepo}>
            Remove repo
          </button>
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Display name</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1.5 text-[11px] text-neutral-600 truncate" title={repo.path}>
            {repo.path}
          </p>
        </div>

        <div>
          <label className={labelClass}>Setup script</label>
          <input
            className={inputClass + ' font-mono'}
            value={setupScript}
            onChange={(e) => setSetup(e.target.value)}
            placeholder="e.g. npm install"
          />
          <p className="mt-1.5 text-[11px] text-neutral-600">
            Runs once right after a workspace is created (when auto-run is enabled in Settings).
          </p>
        </div>

        <div>
          <label className={labelClass}>Dev script</label>
          <input
            className={inputClass + ' font-mono'}
            value={devScript}
            onChange={(e) => setDev(e.target.value)}
            placeholder="e.g. npm run dev"
          />
          <p className="mt-1.5 text-[11px] text-neutral-600">
            Dev server command you start/stop from the scripts panel.
          </p>
        </div>
      </div>
    </Modal>
  )
}
