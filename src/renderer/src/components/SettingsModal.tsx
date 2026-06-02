import { useState } from 'react'
import { useStore } from '../store'
import Modal, { inputClass, labelClass, primaryBtn, ghostBtn } from './Modal'
import IntegrationsPanel from './IntegrationsPanel'
import { PERMISSION_ORDER, PERMISSION_LABELS, PERMISSION_DESCRIPTIONS } from '../lib/permission'
import { MODEL_OPTIONS } from '../lib/models'
import type { PermissionMode } from '@shared/types'

export default function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useStore((s) => s.app!.settings)
  const [mode, setMode] = useState<PermissionMode>(settings.defaultPermissionMode)
  const [manualWorkspaceSetup, setManualWorkspaceSetup] = useState(settings.manualWorkspaceSetup)
  const [soundOnComplete, setSoundOnComplete] = useState(settings.soundOnComplete)
  const [model, setModel] = useState(settings.model ?? MODEL_OPTIONS[0].id)

  const save = async (): Promise<void> => {
    await window.api.settings.update({
      defaultPermissionMode: mode,
      manualWorkspaceSetup,
      soundOnComplete,
      model
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
      <div className="space-y-5">
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
              checked={soundOnComplete}
              onChange={(e) => setSoundOnComplete(e.target.checked)}
              className="accent-blue-600 h-3.5 w-3.5 mt-0.5"
            />
            <span className="text-[12.5px] text-neutral-300">
              Play a sound when a session response completes
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
            <label className={labelClass}>Model</label>
            <select
              className={inputClass}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {!MODEL_OPTIONS.some((m) => m.id === model) && (
                <option value={model}>{model}</option>
              )}
            </select>
            <p className="mt-1.5 text-[11px] text-neutral-600">
              Applies to new sessions. The model is shown in each session header.
            </p>
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
