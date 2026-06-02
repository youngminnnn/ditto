import { useState } from 'react'
import { useStore } from '../store'
import Modal, { inputClass, labelClass, primaryBtn, ghostBtn } from './Modal'
import type { PermissionMode } from '@shared/types'

const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: '확인 요청 (위험 동작 시 묻기)' },
  { value: 'acceptEdits', label: '편집 자동 승인' },
  { value: 'plan', label: '플랜 (읽기 전용)' },
  { value: 'bypassPermissions', label: '모두 자동 승인' }
]

export default function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useStore((s) => s.app!.settings)
  const [mode, setMode] = useState<PermissionMode>(settings.defaultPermissionMode)
  const [autoRunSetup, setAutoRunSetup] = useState(settings.autoRunSetup)
  const [model, setModel] = useState(settings.model ?? '')

  const save = async (): Promise<void> => {
    await window.api.settings.update({
      defaultPermissionMode: mode,
      autoRunSetup,
      model: model.trim() || null
    })
    onClose()
  }

  return (
    <Modal
      title="설정"
      onClose={onClose}
      footer={
        <>
          <button className={ghostBtn} onClick={onClose}>
            취소
          </button>
          <button className={primaryBtn} onClick={save}>
            저장
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelClass}>새 workspace 기본 권한 모드</label>
          <select
            className={inputClass}
            value={mode}
            onChange={(e) => setMode(e.target.value as PermissionMode)}
          >
            {PERMISSION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRunSetup}
            onChange={(e) => setAutoRunSetup(e.target.checked)}
            className="accent-blue-600 h-3.5 w-3.5"
          />
          <span className="text-[12.5px] text-neutral-300">
            workspace 생성 시 setup 스크립트 자동 실행
          </span>
        </label>

        <div>
          <label className={labelClass}>모델 (비워두면 CLI 기본값)</label>
          <input
            className={inputClass + ' font-mono'}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="예: claude-opus-4-8 / claude-sonnet-4-6"
          />
        </div>

        <p className="text-[11px] text-neutral-600 leading-relaxed border-t border-[#23262d] pt-3">
          Ditto 는 설치된 Claude Code 의 로그인 정보를 그대로 사용합니다. 별도 API 키 설정은
          필요하지 않습니다.
        </p>
      </div>
    </Modal>
  )
}
