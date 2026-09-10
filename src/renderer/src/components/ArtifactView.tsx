import { useEffect, useState } from 'react'
import type { ArtifactKind } from '@shared/types'
import { artifactUrl } from '@shared/artifactUrl'
import { useHostedView } from '../lib/hostedView'
import { MarkdownBody } from './ChatPrimitives'

/**
 * 아티팩트 **한 개를 그리는 것만** 하는 조각 — 고르는 UI 도, 주소창도, 앞뒤 버튼도 없다.
 *
 * 껍데기를 일부러 뺐다. 인앱 브라우저가 들어오면 아티팩트는 `artifact` 종류의 **탭**이 되고,
 * 탭 스트립·주소창·히스토리·분할·분리 창은 그쪽이 전부 제공한다. 그때 갈아 끼울 것이
 * 이 파일 하나로 끝나도록, "무엇을 고를까" 는 [[ArtifactPanel]] 에 두고 여기는 "고른 것을
 * 어떻게 띄우나" 만 안다.
 *
 * 그래서 이 컴포넌트가 받는 것은 아티팩트의 좌표(workspaceId · id · version · kind)와, 뷰가
 * 앉을 탭의 id 뿐이다. 목록도 버전 드롭다운도 prop 으로 안 받는다 — 받는 순간 껍데기가
 * 여기로 새어 든다.
 *
 * 게스트는 `<webview>` 가 아니라 main 이 소유하는 뷰다([[main/webViews]]). 여기서 놓는 것은
 * 자리표시자 하나이고, 파티션·세션·이동 가드는 전부 뷰를 만드는 쪽이 정한다 — 렌더러가
 * 태그에 적어 둔 값을 나중에 다시 강제할 일이 없다.
 */
export default function ArtifactView({
  workspaceId,
  tabId,
  artifactId,
  version,
  kind,
  active
}: {
  workspaceId: string
  /** 이 아티팩트를 담은 탭의 id. 뷰의 상태 방송이 이 id 로 온다. */
  tabId: string
  /** 아직 아무것도 없으면 null — 게스트는 붙여 두고 화면만 비운다. */
  artifactId: string | null
  version: number | null
  kind: ArtifactKind | null
  /** 지금 보이는지. 감춰져 있는 동안에는 원본을 당겨 오지 않는다. */
  active: boolean
}): React.JSX.Element {
  const { ref, attached } = useHostedView({ tabId, workspaceId, kind: 'artifact' })
  /**
   * 마크다운은 웹뷰를 타지 않는다 — 앱 안에서 기존 MarkdownBody 로 그린다.
   * 어느 (id, version) 의 것인지 함께 들고 있어야 선택을 바꾼 직후 옛 본문이 잠깐 남지 않는다.
   */
  const [markdown, setMarkdown] = useState<{ id: string; version: number; text: string } | null>(
    null
  )

  const isMarkdown = kind === 'markdown'
  const markdownText =
    isMarkdown && artifactId !== null && markdown?.id === artifactId && markdown.version === version
      ? markdown.text
      : null

  // 고른 것을 게스트에 밀어 넣는다. 명령형이라 "고르면 간다" 가 그대로 코드가 된다.
  useEffect(() => {
    if (artifactId === null || version === null) return

    if (kind === 'markdown') {
      if (!active) return undefined
      let cancelled = false
      void window.api.artifact.read(workspaceId, artifactId, version).then((src) => {
        if (!cancelled) setMarkdown({ id: artifactId, version, text: src?.text ?? '' })
      })
      return () => {
        cancelled = true
      }
    }

    if (!attached) return undefined
    void window.api.views.load(tabId, artifactUrl(workspaceId, artifactId, version))
    return undefined
  }, [workspaceId, tabId, artifactId, version, kind, attached, active])

  return (
    <div className="relative flex-1 min-h-0 bg-white">
      {/* 자리표시자다. 마크다운을 볼 때는 크기를 0 으로 접어 뷰가 스스로 숨는다 — 언마운트하면
          HTML 아티팩트로 돌아올 때 페이지가 처음부터 다시 로드된다([[lib/hostedView]]). */}
      <div
        ref={ref}
        data-hosted-view={tabId}
        className={isMarkdown ? 'hidden' : 'absolute inset-0'}
      />
      {isMarkdown && markdownText !== null && (
        <div className="absolute inset-0 overflow-auto bg-neutral-950 px-5 py-4">
          <div className="md text-base text-neutral-200">
            <MarkdownBody text={markdownText} />
          </div>
        </div>
      )}
    </div>
  )
}
