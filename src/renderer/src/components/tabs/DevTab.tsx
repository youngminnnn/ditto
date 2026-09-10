import PreviewPanel from '../PreviewPanel'
import Composer from '../Composer'
import type { Workspace, WorkspaceTab } from '@shared/types'

/**
 * dev 프리뷰 탭 — 이 워크트리가 띄운 dev 서버를 전체 폭으로 본다.
 *
 * 대화 탭과 달리 우측 작업 패널이 없다. 프리뷰는 "지금 이 브랜치의 화면" 을 실제 크기로 보는
 * 것이 목적인데, 660px 짜리 칸에 가두면 반응형이 다르게 걸려 그 목적이 반쯤 사라진다.
 *
 * **컴포저를 탭마다 그리는 것이 의도다.** 화면에서 요소를 짚어 놓고 말할 데가 없으면 이 기능의
 * 본체가 사라지므로 입력창은 어느 탭에든 있어야 하는데, 그렇다고 위로 끌어올릴 필요는 없다 —
 * 초안(`drafts`)과 첨부(`composerAttachments`)가 이미 스토어에 **워크스페이스 단위**로 있어서
 * 탭을 옮겨도 같은 내용이 그대로 보인다. 끌어올리면 서브에이전트 입력창(주소·라벨·canSend
 * 게이트·릴레이 안내문)까지 함께 끌어올려야 하는데, 그 대가를 치르고 얻는 것이 없다.
 */
export default function DevTab({
  workspace,
  tab,
  navTarget
}: {
  workspace: Workspace
  /** 이 탭. id 는 main 이 발급한 것이고, 뷰의 상태 방송이 그 id 로 온다. */
  tab: WorkspaceTab
  /** 탭을 열면서 함께 온 이동 명령("Open in Preview"). 같은 주소를 다시 눌러도 seq 로 구분한다. */
  navTarget: { url: string; seq: number } | null
}): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className="flex-1 min-h-0">
        <PreviewPanel workspace={workspace} tabId={tab.id} navTarget={navTarget} active />
      </div>
      <Composer workspace={workspace} />
    </div>
  )
}
