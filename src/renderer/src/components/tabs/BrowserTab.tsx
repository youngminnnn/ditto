import PreviewPanel from '../PreviewPanel'
import Composer from '../Composer'
import type { Workspace, WorkspaceTab } from '@shared/types'

/**
 * 웹을 그리는 탭 — 이 워크트리의 dev 서버(`dev`)이거나 바깥 사이트(`web`)다.
 *
 * 둘을 한 컴포넌트로 두는 이유는 화면이 같아서다. 주소창·앞뒤·새로고침·요소 픽커·스크린샷·
 * 콘솔 배지는 dev 서버든 문서 사이트든 똑같이 쓸모가 있다. 갈리는 것은 **세션 파티션**뿐이고
 * (쿠키가 서로 새면 안 된다) 그 판단은 main 이 `kind` 로 한다([[main/webViews]] partitionFor).
 *
 * Work 탭과 달리 우측 작업 패널이 없다. 프리뷰는 "지금 이 브랜치의 화면" 을 실제 크기로 보는
 * 것이 목적인데, 660px 짜리 칸에 가두면 반응형이 다르게 걸려 그 목적이 반쯤 사라진다.
 *
 * **컴포저를 탭마다 그리는 것이 의도다.** 화면에서 요소를 짚어 놓고 말할 데가 없으면 이 기능의
 * 본체가 사라지므로 입력창은 어느 탭에든 있어야 하는데, 그렇다고 위로 끌어올릴 필요는 없다 —
 * 초안(`drafts`)과 첨부(`composerAttachments`)가 이미 스토어에 **워크스페이스 단위**로 있어서
 * 탭을 옮겨도 같은 내용이 그대로 보인다. 끌어올리면 서브에이전트 입력창(주소·라벨·canSend
 * 게이트·릴레이 안내문)까지 함께 끌어올려야 하는데, 그 대가를 치르고 얻는 것이 없다.
 */
export default function BrowserTab({
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
        <PreviewPanel
          workspace={workspace}
          tabId={tab.id}
          kind={tab.kind === 'web' ? 'web' : 'dev'}
          navTarget={navTarget}
          active
        />
      </div>
      <Composer workspace={workspace} />
    </div>
  )
}
