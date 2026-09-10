import ArtifactPanel from '../ArtifactPanel'
import Composer from '../Composer'
import type { Workspace } from '@shared/types'

/**
 * 에이전트가 만든 것을 실행해 보는 탭.
 *
 * 우측 작업 패널에 있던 것을 전체 폭으로 올렸다. 아티팩트는 차트·대시보드처럼 **보라고 만든
 * 것**이라 660px 짜리 칸에 가두면 만든 이유가 반쯤 사라진다.
 *
 * **아티팩트 하나가 아니라 목록째로 탭 하나다.** 목업에서는 아티팩트마다 탭이었지만, 그러면
 * "무엇이 있나"(목록·버전 드롭다운)가 갈 곳이 없어진다 — 지금 그 역할은 `ArtifactPanel` 이
 * 하고 있고, 그것을 대신할 자리를 새로 짓는 것은 이 단계에서 늘릴 범위가 아니다. 파일이
 * All files 패널과 파일 탭으로 나뉘어 있는 것과 달리, 아티팩트에는 그 "목록 패널" 이 따로 없다.
 *
 * 컴포저를 두는 이유는 다른 탭과 같다 — 만들어진 것을 보면서 "여기 축 이름 바꿔줘" 라고 말할
 * 데가 있어야 한다. 초안·첨부는 스토어에 워크스페이스 단위로 있어 탭을 옮겨도 그대로다.
 */
export default function ArtifactTab({
  workspace,
  tabId,
  target
}: {
  workspace: Workspace
  tabId: string
  /** 방금 만든 것을 열라는 명령. seq 가 바뀔 때만 따라간다. */
  target: { artifactId: string; version: number; seq: number } | null
}): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className="flex-1 min-h-0">
        <ArtifactPanel workspace={workspace} tabId={tabId} target={target} active />
      </div>
      <Composer workspace={workspace} />
    </div>
  )
}
