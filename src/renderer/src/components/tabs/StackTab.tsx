import Composer from '../Composer'
import StackScreen from '../stack/StackScreen'
import type { Workspace } from '@shared/types'

/**
 * 스택 화면을 담는 탭. `FileTab`·`BrowserTab` 과 같은 모양이다 — 화면 아래 컴포저를 둔다.
 *
 * 스택을 보면서 "이거 리베이스해줘" 라고 말할 데가 있어야 한다. 초안(drafts)·첨부
 * (composerAttachments)는 스토어에 워크스페이스 단위로 있어, 탭을 오가도(다른 탭으로 나갔다
 * 돌아와도) 그대로 남는다.
 */
export default function StackTab({
  workspace,
  target,
  onClose
}: {
  /** 이 탭을 담은 워크스페이스 — 컴포저가 향하는 대화다. */
  workspace: Workspace
  /** 스택의 앵커 워크스페이스 id(main 이 탭의 target 으로 들고 있다). 비었거나 사라졌으면
   * `StackScreen` 이 이미 "스택이 아니다" 를 그린다. */
  target: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className="flex-1 min-h-0">
        <StackScreen workspaceId={target} onClose={onClose} />
      </div>
      <Composer workspace={workspace} />
    </div>
  )
}
