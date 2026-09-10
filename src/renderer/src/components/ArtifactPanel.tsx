import { useCallback, useEffect, useRef, useState } from 'react'
import { FileCode2, Loader2, Trash2 } from 'lucide-react'
import type { ArtifactSummary, Workspace } from '@shared/types'
import ArtifactView from './ArtifactView'

/**
 * Artifacts 탭 — 어느 아티팩트를 볼지 고르는 곳.
 *
 * **그리는 일은 [[ArtifactView]] 가 한다.** 둘을 가른 이유는 인앱 브라우저다 — 아티팩트가
 * `artifact` 종류의 탭이 되면 "고르는 것" 은 탭 스트립이 가져가고 이 파일은 사라지지만,
 * 그리는 조각은 그대로 탭 안에 얹힌다. 지금 섞어 두면 그때 둘을 손으로 떼어내야 한다.
 *
 * Preview 와 나란히 서지만 신뢰 수준이 반대다. Preview 의 게스트는 사용자 자신의 dev 서버라
 * 웹을 돌아다녀도 되고, 여기 게스트는 모델이 쓴 코드라 아무 데도 못 간다. 그 차이는 전부
 * main 이 집행한다([[main/artifactProtocol]], [[main/preview]] `guardArtifactGuest`) —
 * 이 파일은 그 울타리 **안에** 무엇을 띄울지만 정한다.
 *
 * 목록을 zustand 스토어에 두지 않고 여기서 직접 IPC 로 읽는 이유가 있다. 작업 패널은 분리된
 * 창으로 떨어질 수 있고, 스토어 구독은 `init()` 과 `initPane()` **양쪽**에 걸어야 한다 —
 * 한쪽을 빠뜨리면 분리 창에서 에러 없이 조용히 죽는다. 패널이 자기 것을 자기가 읽으면 그
 * 갈래가 아예 생기지 않는다.
 */

export default function ArtifactPanel({
  workspace,
  tabId,
  target,
  active
}: {
  workspace: Workspace
  /** 이 패널이 사는 탭의 id — 게스트 뷰가 그 id 로 상태를 방송한다([[main/webViews]]). */
  tabId: string
  /**
   * 탭을 여는 쪽이 넘기는 "이걸 열어라" 명령(create_artifact 가 방금 만든 것).
   * seq 가 바뀔 때만 따라간다 — 같은 명령을 두 번 따라가면 사용자가 방금 고른 버전을 뺏는다.
   */
  target: { artifactId: string; version: number; seq: number } | null
  /** 지금 이 탭이 보이는지. 감춰져 있는 동안에는 원본을 당겨 오지 않는다. */
  active: boolean
}): React.JSX.Element {
  /** 이미 따라간 명령의 seq. */
  const handledSeq = useRef<number | null>(null)

  const [list, setList] = useState<ArtifactSummary[] | null>(null)
  /** 사용자가 **명시적으로** 고른 것. null 이면 목록의 맨 앞(가장 최근)을 따라간다. */
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [version, setVersion] = useState<number | null>(null)

  // 무엇을 보고 있는지는 전부 **파생**이다. 목록이 바뀔 때 골라 주는 effect 를 두면 그
  // effect 가 렌더를 한 번 더 유발하고, "고른 것" 과 "목록" 이 잠깐 어긋난 채로 그려진다.
  const selected = list?.find((a) => a.id === pickedId) ?? list?.[0] ?? null
  const shownVersion = version ?? selected?.versions[0] ?? null

  const refresh = useCallback(async (): Promise<ArtifactSummary[]> => {
    const next = await window.api.artifact.list(workspace.id)
    setList(next)
    return next
  }, [workspace.id])

  // 목록: 마운트 때 한 번, 그리고 main 이 바뀌었다고 알릴 때마다.
  useEffect(() => {
    void refresh()
    return window.api.artifact.onChanged((e) => {
      if (e.workspaceId !== workspace.id) return
      void refresh()
    })
  }, [workspace.id, refresh])

  // 도구가 방금 만든 것으로 따라간다.
  useEffect(() => {
    if (!target || handledSeq.current === target.seq) return
    handledSeq.current = target.seq
    setPickedId(target.artifactId)
    setVersion(target.version)
  }, [target])

  const remove = async (id: string): Promise<void> => {
    await window.api.artifact.remove(workspace.id, id)
    const next = await refresh()
    if (selected?.id === id) {
      setPickedId(next[0]?.id ?? null)
      setVersion(null)
    }
  }

  return (
    <div className="h-full flex min-h-0">
      <ArtifactList
        list={list}
        selectedId={selected?.id ?? null}
        onSelect={(id) => {
          setPickedId(id)
          setVersion(null)
        }}
        onRemove={(id) => void remove(id)}
      />

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {selected && selected.versions.length > 1 && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 text-2xs text-neutral-400">
            <span className="truncate">{selected.title}</span>
            <select
              className="ml-auto bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5"
              aria-label="Version"
              value={shownVersion ?? ''}
              onChange={(e) => setVersion(Number(e.target.value))}
            >
              {selected.versions.map((v) => (
                <option key={v} value={v}>
                  v{v}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="relative flex-1 min-h-0">
          <ArtifactView
            workspaceId={workspace.id}
            tabId={tabId}
            artifactId={selected?.id ?? null}
            version={shownVersion}
            kind={selected?.kind ?? null}
            active={active}
          />
          {list !== null && list.length === 0 && <EmptyState />}
          {list === null && (
            <div className="absolute inset-0 grid place-items-center bg-neutral-950">
              <Loader2 size={16} className="animate-spin text-neutral-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ArtifactList({
  list,
  selectedId,
  onSelect,
  onRemove
}: {
  list: ArtifactSummary[] | null
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}): React.JSX.Element | null {
  if (!list?.length) return null
  return (
    <div className="w-48 shrink-0 border-r border-neutral-800 overflow-y-auto py-1">
      {list.map((a) => (
        <div
          key={a.id}
          className={`group flex items-center gap-1.5 px-2 py-1.5 text-xs cursor-pointer ${
            a.id === selectedId ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400'
          }`}
          onClick={() => onSelect(a.id)}
        >
          <FileCode2 size={13} className="shrink-0 opacity-70" />
          <span className="truncate flex-1">{a.title}</span>
          <button
            className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-neutral-200"
            aria-label={`Delete ${a.title}`}
            title="Delete"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(a.id)
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="absolute inset-0 grid place-items-center bg-neutral-950 px-6 text-center">
      <div className="max-w-xs">
        <FileCode2 size={20} className="mx-auto mb-2 text-neutral-600" />
        <p className="text-sm text-neutral-400">No artifacts yet.</p>
        <p className="mt-1 text-xs text-neutral-500">
          Ask the agent to build something — a page, a chart, a document — and it shows up here,
          running.
        </p>
      </div>
    </div>
  )
}
