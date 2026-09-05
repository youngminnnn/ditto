import { useEffect, useRef, useState } from 'react'
import { artifactPartition } from '@shared/types'
import type { ArtifactKind } from '@shared/types'
import { artifactUrl } from '@shared/artifactUrl'
import type { PreviewWebview } from '../lib/webview'
import { MarkdownBody } from './ChatPrimitives'

/**
 * 아티팩트 **한 개를 그리는 것만** 하는 조각 — 고르는 UI 도, 주소창도, 앞뒤 버튼도 없다.
 *
 * 껍데기를 일부러 뺐다. 인앱 브라우저가 들어오면 아티팩트는 `artifact` 종류의 **탭**이 되고,
 * 탭 스트립·주소창·히스토리·분할·분리 창은 그쪽이 전부 제공한다. 그때 갈아 끼울 것이
 * 이 파일 하나로 끝나도록, "무엇을 고를까" 는 [[ArtifactPanel]] 에 두고 여기는 "고른 것을
 * 어떻게 띄우나" 만 안다.
 *
 * 그래서 이 컴포넌트가 받는 것은 아티팩트의 좌표(workspaceId · id · version · kind)뿐이다.
 * 목록도 버전 드롭다운도 prop 으로 안 받는다 — 받는 순간 껍데기가 여기로 새어 든다.
 */
export default function ArtifactView({
  workspaceId,
  artifactId,
  version,
  kind,
  active
}: {
  workspaceId: string
  /** 아직 아무것도 없으면 null — 게스트는 붙여 두고 화면만 비운다. */
  artifactId: string | null
  version: number | null
  kind: ArtifactKind | null
  /** 지금 보이는지. 감춰져 있는 동안에는 원본을 당겨 오지 않는다. */
  active: boolean
}): React.JSX.Element {
  const viewRef = useRef<PreviewWebview | null>(null)
  // 게스트가 붙기 전에는 loadURL 이 던진다. dom-ready 를 본 뒤에만 명령을 보낸다.
  const [ready, setReady] = useState(false)
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

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const onDomReady = (): void => setReady(true)
    view.addEventListener('dom-ready', onDomReady)
    return () => view.removeEventListener('dom-ready', onDomReady)
  }, [])

  // 고른 것을 게스트에 밀어 넣는다. `src` prop 이 아니라 명령형 loadURL 이어야 한다 —
  // prop 에 매달면 상태가 한 번 흐를 때마다 보던 화면이 처음으로 되감긴다.
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

    const view = viewRef.current
    if (!view || !ready) return
    void view.loadURL(artifactUrl(workspaceId, artifactId, version)).catch(() => {
      /* 게스트가 사라지는 중. 다음 선택이 다시 시도한다. */
    })
    return undefined
  }, [workspaceId, artifactId, version, kind, ready, active])

  return (
    <div className="relative flex-1 min-h-0 bg-white">
      {/* 게스트는 언마운트하지 않고 감춘다 — 마크다운으로 옮겨 갈 때마다 게스트를 버리면
          다시 HTML 아티팩트를 열 때 처음부터 붙어야 한다. */}
      <webview
        ref={(el) => {
          viewRef.current = el
        }}
        src={BOOT_URL}
        partition={artifactPartition(workspaceId)}
        webpreferences={GUEST_PREFS}
        className={isMarkdown ? 'hidden' : 'absolute inset-0'}
        style={{ width: '100%', height: '100%' }}
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

/** Preview 와 같은 값. 태그만 읽는 사람에게도 "이 뷰는 격리돼 있다" 가 보여야 한다. */
const GUEST_PREFS = 'contextIsolation=yes,sandbox=yes,nodeIntegration=no,javascript=yes'

/**
 * 게스트를 붙이기 위한 최초 `src`. **반드시 있어야 하고, 반드시 상수여야 한다** —
 * 이유는 [[PreviewPanel]] 의 같은 상수에 적어 두었다(빈 `src` 면 게스트가 안 생기고,
 * React 가 매 렌더마다 prop 을 다시 써 넣으면 보던 페이지가 되감긴다).
 */
const BOOT_URL = 'about:blank'
