import { useState } from 'react'
import {
  Files,
  GitCompare,
  GitCommitVertical,
  CheckCheck,
  SquareArrowOutUpRight
} from 'lucide-react'
import FileBrowser from './FileBrowser'
import ChangesPanel from './ChangesPanel'
import CommitsPanel from './CommitsPanel'
import ChecksPanel from './ChecksPanel'
import { useStore } from '../store'
import { isPaneWindow } from '../lib/paneWindow'
import type { Workspace } from '@shared/types'

type Tab = 'files' | 'changes' | 'check'
type ChangesView = 'changes' | 'commits'

const TABS: {
  id: Tab
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}[] = [
  { id: 'files', label: 'All files', icon: Files },
  { id: 'changes', label: 'Changes', icon: GitCompare },
  { id: 'check', label: 'Check', icon: CheckCheck }
]

/**
 * 우상단 탭 패널: All files / Changes / Check.
 *
 * Preview 는 여기 있다가 워크스페이스 탭으로 승격됐다([[components/TabStrip]]) — 이 패널은
 * 대화와 **나란히** 보는 것들만 담는다. 프리뷰는 전체 폭으로 봐야 반응형이 제대로 걸린다.
 */
export default function WorkPanel({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('changes')
  const [changesView, setChangesView] = useState<ChangesView>('changes')
  const detachPane = useStore((s) => s.detachPane)

  return (
    <div className="h-full flex flex-col min-h-0 bg-[var(--bg)]">
      {/*
        탭 줄이 자기 폭을 기준으로 스스로 줄어든다. 이 패널은 창 폭이 아니라 스플리터로 정해지므로
        viewport 미디어 쿼리로는 맞출 수 없다 — 워크스페이스 헤더가 같은 이유로 컨테이너 쿼리를
        쓴다([[index.css]] .workspace-header). 좁아지면 라벨이 사라지고 아이콘만 남는다.
      */}
      <div className="workpanel-tabs h-9 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--border)]">
        {/* 아이콘만 남을 정도로 좁아지면 그마저도 넘칠 수 있다. 그때는 눌리는 대신 스크롤한다
            (터미널 탭이 쓰는 방식과 같다 — TerminalPane 의 탭 줄). */}
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                // 라벨이 감춰지면 버튼에 남는 것은 아이콘뿐이라, 이름을 여기서 보장한다.
                aria-label={label}
                title={label}
                className={
                  'flex items-center gap-1.5 shrink-0 text-sm px-2.5 py-1 rounded-md ' +
                  (active
                    ? 'bg-[var(--surface-2)] text-neutral-100'
                    : 'text-neutral-400 hover:text-neutral-200')
                }
              >
                <Icon size={13} className="shrink-0" />
                <span className="workpanel-tab-label">{label}</span>
              </button>
            )
          })}
        </div>

        {/* 이미 별도 창이면 더 뗄 곳이 없다 — 인라인일 때만 분리 버튼을 보여 준다. */}
        {!isPaneWindow && (
          <button
            onClick={() => detachPane('work')}
            aria-label="Open work panel in a separate window"
            title="Open in a separate window"
            className="h-6 w-6 shrink-0 grid place-items-center rounded-md text-neutral-500 hover:bg-[var(--surface-2)] hover:text-neutral-200"
          >
            <SquareArrowOutUpRight size={13} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'files' && <FileBrowser workspaceId={workspace.id} />}
        {tab === 'changes' && (
          <div className="h-full flex flex-col min-h-0">
            <div
              role="tablist"
              aria-label="Changes view"
              className="h-9 shrink-0 flex items-center gap-1 px-3 border-b border-[var(--border)]"
            >
              {(
                [
                  { id: 'changes', label: 'Changes', icon: GitCompare },
                  { id: 'commits', label: 'Commits', icon: GitCommitVertical }
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = changesView === id
                return (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setChangesView(id)}
                    className={
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ' +
                      (active
                        ? 'bg-[var(--surface-2)] text-neutral-200'
                        : 'text-neutral-500 hover:text-neutral-300')
                    }
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                )
              })}
            </div>
            <div className="flex-1 min-h-0">
              {changesView === 'changes' ? (
                <ChangesPanel workspaceId={workspace.id} baseBranch={workspace.baseBranch} />
              ) : (
                <CommitsPanel workspaceId={workspace.id} />
              )}
            </div>
          </div>
        )}
        {tab === 'check' && <ChecksPanel workspaceId={workspace.id} />}
      </div>
    </div>
  )
}
