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
      `리포 "${repo.name}" 를 제거할까요?` +
        (wsCount > 0
          ? `\nworkspace ${wsCount}개와 그 worktree 디렉토리도 함께 제거됩니다. (브랜치는 유지)`
          : '')
    )
    if (!ok) return
    await window.api.repo.remove(repoId)
    onClose()
  }

  return (
    <Modal
      title={`리포 설정 · ${repo.name}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className={ghostBtn + ' mr-auto text-red-400 hover:bg-red-500/15'} onClick={removeRepo}>
            리포 제거
          </button>
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
          <label className={labelClass}>표시 이름</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1.5 text-[11px] text-neutral-600 truncate" title={repo.path}>
            {repo.path}
          </p>
        </div>

        <div>
          <label className={labelClass}>Setup 스크립트</label>
          <input
            className={inputClass + ' font-mono'}
            value={setupScript}
            onChange={(e) => setSetup(e.target.value)}
            placeholder="예: npm install"
          />
          <p className="mt-1.5 text-[11px] text-neutral-600">
            workspace 생성 직후 1회 실행 (설정의 자동 실행이 켜져 있을 때).
          </p>
        </div>

        <div>
          <label className={labelClass}>Dev 스크립트</label>
          <input
            className={inputClass + ' font-mono'}
            value={devScript}
            onChange={(e) => setDev(e.target.value)}
            placeholder="예: npm run dev"
          />
          <p className="mt-1.5 text-[11px] text-neutral-600">
            스크립트 패널에서 실행/중지하는 개발 서버 명령.
          </p>
        </div>
      </div>
    </Modal>
  )
}
