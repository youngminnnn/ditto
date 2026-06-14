import { useState } from 'react'
import { useStore } from '../store'
import Modal, { inputClass, labelClass, primaryBtn, ghostBtn } from './Modal'
import IntegrationsPanel from './IntegrationsPanel'
import { PERMISSION_ORDER, PERMISSION_LABELS, PERMISSION_DESCRIPTIONS } from '../lib/permission'
import { MODEL_OPTIONS } from '../lib/models'
import { applyTheme } from '../lib/theme'
import type { PermissionMode, ThemePreference } from '@shared/types'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
]

export default function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useStore((s) => s.app!.settings)
  const [mode, setMode] = useState<PermissionMode>(settings.defaultPermissionMode)
  const [manualWorkspaceSetup, setManualWorkspaceSetup] = useState(settings.manualWorkspaceSetup)
  const [soundOnComplete, setSoundOnComplete] = useState(settings.soundOnComplete)
  const [autoCompact, setAutoCompact] = useState(settings.autoCompact)
  const [defaultRightPanelOpen, setDefaultRightPanelOpen] = useState(settings.defaultRightPanelOpen)
  const [model, setModel] = useState(settings.model ?? MODEL_OPTIONS[0].id)
  const [theme, setTheme] = useState<ThemePreference>(settings.theme)

  // 테마는 즉시 미리보기로 적용한다. 저장 없이 닫으면 저장된 테마로 되돌린다.
  const previewTheme = (next: ThemePreference): void => {
    setTheme(next)
    applyTheme(next)
  }
  const cancel = (): void => {
    if (theme !== settings.theme) applyTheme(settings.theme)
    onClose()
  }

  const save = async (): Promise<void> => {
    await window.api.settings.update({
      defaultPermissionMode: mode,
      manualWorkspaceSetup,
      soundOnComplete,
      autoCompact,
      defaultRightPanelOpen,
      model,
      theme
    })
    onClose()
  }

  return (
    <Modal
      title="Settings"
      onClose={cancel}
      width={560}
      footer={
        <>
          <button className={ghostBtn} onClick={cancel}>
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

        <Section title="Appearance">
          <div>
            <label className={labelClass}>Theme</label>
            <div className="flex gap-1.5">
              {THEME_OPTIONS.map((opt) => {
                const active = theme === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => previewTheme(opt.value)}
                    className={
                      'flex-1 text-[12.5px] px-3 py-1.5 rounded-lg border transition-colors ' +
                      (active
                        ? 'border-blue-500 bg-blue-600/15 text-neutral-100'
                        : 'border-[var(--border)] text-neutral-300 hover:bg-[var(--surface-2)]')
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-600">
              System follows your OS light/dark setting.
            </p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={defaultRightPanelOpen}
              onChange={(e) => setDefaultRightPanelOpen(e.target.checked)}
              className="accent-blue-600 h-3.5 w-3.5 mt-0.5"
            />
            <span className="text-[12.5px] text-neutral-300">
              Show the work panel by default
              <span className="block text-[11px] text-neutral-600">
                Starting state for the right-side work panel (files, changes, terminal). Toggling it
                with ⌘J is remembered and takes over from here.
              </span>
            </span>
          </label>
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
              Default for new workspaces. Each workspace can override this from its header dropdown.
            </p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCompact}
              onChange={(e) => setAutoCompact(e.target.checked)}
              className="accent-blue-600 h-3.5 w-3.5 mt-0.5"
            />
            <span className="text-[12.5px] text-neutral-300">
              Auto-compact conversation when context fills
              <span className="block text-[11px] text-neutral-600">
                Like Claude Code, summarizes the conversation as it approaches the context limit so
                long sessions keep room to continue.
              </span>
            </span>
          </label>
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
