import { useEffect, useState } from 'react'
import { useStore } from '../store'
import Modal, { inputClass, labelClass, primaryBtn, ghostBtn } from './Modal'
import { sanitizePreview } from '../lib/format'

export default function NewWorkspaceModal({
  repoId,
  onClose
}: {
  repoId: string
  onClose: () => void
}): React.JSX.Element {
  const app = useStore((s) => s.app)!
  const repo = app.repos.find((r) => r.id === repoId)!
  const [name, setName] = useState('')
  const [branches, setBranches] = useState<string[]>([repo.defaultBranch])
  const [base, setBase] = useState(repo.defaultBranch)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.repo.listBranches(repoId).then((list) => {
      if (list.length) {
        setBranches(list)
        setBase(list[0])
      }
    })
  }, [repoId])

  const create = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    const res = await window.api.workspace.create({ repoId, name: name.trim(), baseBranch: base })
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    if (res.workspaceId) void useStore.getState().selectWorkspace(res.workspaceId)
    onClose()
  }

  return (
    <Modal
      title={`새 workspace · ${repo.name}`}
      onClose={onClose}
      footer={
        <>
          <button className={ghostBtn} onClick={onClose}>
            취소
          </button>
          <button className={primaryBtn} onClick={create} disabled={!name.trim() || busy}>
            {busy ? '생성 중…' : '생성'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={labelClass}>이름</label>
          <input
            autoFocus
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="예: 로그인 버그 수정"
          />
          {name.trim() && (
            <p className="mt-1.5 text-[11px] text-neutral-600">
              브랜치 <span className="text-neutral-400">{sanitizePreview(name)}</span> 가
              생성됩니다.
            </p>
          )}
        </div>

        <div>
          <label className={labelClass}>베이스 브랜치</label>
          <select
            className={inputClass}
            value={base}
            onChange={(e) => setBase(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 whitespace-pre-wrap">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
