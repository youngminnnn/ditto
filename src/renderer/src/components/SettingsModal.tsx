import { useState } from 'react'
import { useStore } from '../store'
import Modal, { inputClass, labelClass, primaryBtn, ghostBtn } from './Modal'
import IntegrationsPanel from './IntegrationsPanel'
import { PERMISSION_ORDER, PERMISSION_LABELS, PERMISSION_DESCRIPTIONS } from '../lib/permission'
import type { PermissionMode } from '@shared/types'

export default function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useStore((s) => s.app!.settings)
  const [mode, setMode] = useState<PermissionMode>(settings.defaultPermissionMode)
  const [autoRunSetup, setAutoRunSetup] = useState(settings.autoRunSetup)
  const [manualWorkspaceSetup, setManualWorkspaceSetup] = useState(settings.manualWorkspaceSetup)
  const [model, setModel] = useState(settings.model ?? '')

  const save = async (): Promise<void> => {
    await window.api.settings.update({
      defaultPermissionMode: mode,
      autoRunSetup,
      manualWorkspaceSetup,
      model: model.trim() || null
    })
    onClose()
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className={ghostBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
        <Section title="Integrations">
          <IntegrationsPanel />
        </Section>

        <Section title="Workspaces">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={manualWorkspaceSetup}
              onChange={(e) => setManualWorkspaceSetup(e.target.checked)}
              className="accent-blue-600 h-3.5 w-3.5 mt-0.5"
            />
            <span className="text-[12.5px] text-neutral-300">
              Choose name & base branch manually
              <span className="block text-[11px] text-neutral-600">
                Off: auto-generate a name and branch from the repo&rsquo;s default branch (main).
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRunSetup}
              onChange={(e) => setAutoRunSetup(e.target.checked)}
              className="accent-blue-600 h-3.5 w-3.5 mt-0.5"
            />
            <span className="text-[12.5px] text-neutral-300">
              Run setup script when a workspace is created
            </span>
          </label>
        </Section>

        <Section title="Agent">
          <div>
            <label className={labelClass}>Default permission mode for new workspaces</label>
            <select
              className={inputClass}
              value={mode}
              onChange={(e) => setMode(e.target.value as PermissionMode)}
            >
              {PERMISSION_ORDER.map((m) => (
                <option key={m} value={m}>
                  {PERMISSION_LABELS[m]} — {PERMISSION_DESCRIPTIONS[m]}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-neutral-600">
              Press ⇧⇥ in a session to cycle the mode, just like Claude Code.
            </p>
          </div>

          <div>
            <label className={labelClass}>Model (leave blank for the CLI default)</label>
            <input
              className={inputClass + ' font-mono'}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. claude-opus-4-8 / claude-sonnet-4-6"
            />
          </div>
        </Section>
      </div>
    </Modal>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <h4 className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">
        {title}
      </h4>
      {children}
    </div>
  )
}
