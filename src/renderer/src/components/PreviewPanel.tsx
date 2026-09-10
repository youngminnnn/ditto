import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CircleAlert,
  ExternalLink,
  Loader2,
  MousePointerClick,
  Trash2,
  RotateCw,
  TriangleAlert,
  X
} from 'lucide-react'
import { isLocalUrl, normalizeInputUrl } from '@shared/devUrl'
import type { PreviewIssue } from '@shared/previewIssues'
import { useStore } from '../store'
import { isPaneWindow } from '../lib/paneWindow'
import { useHostedView } from '../lib/hostedView'
import { useSuppressViewsOver } from '../lib/viewSuppress'
import { FOCUS_ADDRESS_BAR_EVENT } from '../lib/composerFocus'
import type { HostedViewKind, Workspace } from '@shared/types'

/**
 * Preview 탭 — 이 워크트리가 띄운 dev 서버를 앱 안에서 본다.
 *
 * 범용 브라우저가 아니다. 여러 워크스페이스의 dev 서버를 오가며 "지금 이 브랜치의 화면" 을
 * 보는 것이 전부라, 주소 하나·앞뒤·새로고침·캡처만 있다. 탭도 북마크도 없다.
 *
 * 게스트는 main 이 소유한다([[main/webViews]]). 이 컴포넌트가 놓는 것은 자리표시자 `<div>`
 * 하나이고, 뷰는 그 자리에 네이티브로 그려진다. 그래서 예전에 있던 `src` 되감김 함정 —
 * 렌더할 때마다 prop 이 다시 쓰여 페이지가 처음으로 돌아가던 것 — 이 애초에 성립하지 않는다.
 */
export default function PreviewPanel({
  workspace,
  tabId,
  kind,
  navTarget,
  active
}: {
  workspace: Workspace
  /**
   * 이 프리뷰를 담은 탭의 id. **main 이 발급한 진짜 id 여야 한다.**
   *
   * 뷰의 상태 방송이 이 id 로 오기 때문이다 — 렌더러가 자기 규칙으로 id 를 지어내면, 에이전트가
   * 만든 탭의 방송을 자기 것으로 알아보지 못해 주소창이 빈 채로 남는다.
   */
  tabId: string
  /**
   * dev 서버인가 바깥 웹인가. 쓰이는 곳은 셋이다 — 세션 파티션(쿠키가 서로 안 새게),
   * 빈 화면 안내 문구, 그리고 주소가 없을 때 주소창에 포커스를 줄지.
   */
  kind: HostedViewKind
  /** WorkPanel 이 넘기는 이동 명령("Open in Preview"). seq 가 바뀔 때만 이동한다. */
  navTarget: { url: string; seq: number } | null
  /** 지금 이 탭이 보이는지. 감춰져 있는 동안에는 캡처하지 않는다. */
  active: boolean
}): React.JSX.Element {
  const pushToast = useStore((s) => s.pushToast)

  /**
   * `workspace.previewUrl` 은 **dev 탭만의 것**이다.
   *
   * 이 컴포넌트는 dev 탭과 웹 탭이 함께 쓰는데, 그 값을 양쪽이 나눠 쓰면 두 방향으로 샌다:
   * 새 웹 탭이 dev 서버 주소에서 시작하고, 웹 탭에서 돌아다닌 주소가 dev 쪽에 쌓인다.
   *
   * 뒤쪽이 특히 나쁘다 — `open_preview` 의 `devOrigin()`([[agent/tools/preview]])이 이 값을
   * dev 서버 주소의 **마지막 후보**로 쓰기 때문이다. 웹 탭을 한 번 쓰고 나면 "자기 워크스페이스의
   * dev 서버뿐" 이라는 그 도구의 경계가 조용히 "웹 탭이 마지막으로 있던 곳" 으로 바뀐다.
   */
  const remembered = kind === 'dev' ? (workspace.previewUrl ?? '') : ''

  // 화면에 보이는 주소(게스트가 실제로 있는 곳). 편집 중에는 draft 가 이걸 가린다.
  const [url, setUrl] = useState(remembered)
  const [draft, setDraft] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  // 요소 픽커가 켜져 있는 동안(사용자가 게스트에서 요소를 고르는 중).
  const [picking, setPicking] = useState(false)
  // 콘솔·네트워크 문제. 개수만 방송되므로(폭주 방지) 목록은 패널을 열 때 당겨 온다.
  const [issueCount, setIssueCount] = useState({ errors: 0, warnings: 0 })
  const [issues, setIssues] = useState<PreviewIssue[] | null>(null)

  /** 첫 로드 주소. mount 이후 prop 이 바뀌어도 다시 로드하지 않도록 처음 값을 고정한다. */
  const initialUrl = useRef(navTarget?.url ?? remembered)
  /** 이미 처리한 이동 명령의 seq. 같은 명령을 두 번 따라가지 않는다. */
  const handledSeq = useRef<number | null>(null)

  const { ref, state, failure, attached } = useHostedView({
    tabId,
    workspaceId: workspace.id,
    kind,
    // 뷰를 처음 만들 때만 쓰인다. 여기서 "붙었으니 로드하자" 를 판단하면 탭을 오갈 때마다
    // 그 판단이 다시 일어나 보고 있던 페이지가 처음으로 되감긴다([[lib/hostedView]]).
    initialUrl: initialUrl.current || undefined
  })
  const ready = attached
  const loading = state?.loading ?? false
  const nav = { back: state?.canGoBack ?? false, forward: state?.canGoForward ?? false }

  /**
   * 주소를 워크스페이스에 적어 둔다 — 다음에 이 탭을 열면 여기서 시작한다.
   *
   * dev 탭만 적는다(위 `remembered` 주석). 웹 탭의 마지막 주소를 기억하려면 저장할 자리를
   * 따로 만들어야 하는데, `previewUrl` 은 그 자리가 아니다.
   */
  const remember = (next: string): void => {
    if (kind !== 'dev') return
    if (!next || next === 'about:blank') return
    void window.api.preview.setUrl(workspace.id, next)
  }

  /** 게스트를 이 주소로 보낸다(뷰가 아직 없으면 아래 첫 로드 effect 가 대신 처리한다). */
  const navigate = (next: string): void => {
    setUrl(next)
    setDraft(null)
    initialUrl.current = next
    if (attached) void window.api.views.load(tabId, next)
  }

  // 게스트가 실제로 간 곳을 주소창과 워크스페이스에 반영한다. main 이 접어 보내는 상태
  // 스냅샷 하나가 예전의 did-navigate·did-navigate-in-page 구독을 대신한다.
  useEffect(() => {
    const next = state?.url
    if (!next) return
    setUrl(next)
    setDraft(null)
    remember(next)
    // remember 는 매 렌더 새로 만들어지지만 하는 일은 저장 하나다 — deps 에 넣으면 주소가
    // 그대로여도 매 렌더 다시 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.url])

  // "Open in Preview" 로 들어온 이동 명령.
  useEffect(() => {
    if (!navTarget || handledSeq.current === navTarget.seq) return
    handledSeq.current = navTarget.seq
    navigate(navTarget.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTarget, ready])

  // 개수 방송 구독. 목록은 사용자가 패널을 열 때만 당겨 온다(방송에 목록을 싣지 않는 이유는
  // [[main/previewIssues]] 참고 — 폭주하는 dev 로그가 IPC 홍수가 된다).
  useEffect(() => {
    return window.api.preview.onIssues((e) => {
      if (e.tabId !== tabId) return
      setIssueCount({ errors: e.errors, warnings: e.warnings })
      // 목록을 펼쳐 둔 채라면 새로 들어온 것까지 보이게 갱신한다.
      setIssues((prev) => {
        if (prev === null) return prev
        void window.api.preview.listIssues(tabId).then(setIssues)
        return prev
      })
    })
  }, [tabId])

  const toggleIssues = (): void => {
    if (issues !== null) return setIssues(null)
    void window.api.preview.listIssues(tabId).then(setIssues)
  }

  /** 모아 둔 문제를 컴포저로 보낸다. */
  const sendIssues = async (list: PreviewIssue[]): Promise<void> => {
    if (!list.length) return
    const { error } = await window.api.preview.sendIssues(
      workspace.id,
      tabId,
      list.map((i) => i.id)
    )
    if (error) {
      pushToast('error', error)
      return
    }
    setIssues(null)
    pushToast(
      'success',
      isPaneWindow
        ? `${list.length} issue(s) added to the composer in the main window.`
        : `${list.length} issue(s) added to the composer.`
    )
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const next = normalizeInputUrl(draft ?? url)
    if (!next) {
      pushToast('error', 'That does not look like a URL.')
      return
    }
    navigate(next)
    remember(next)
  }

  /**
   * 요소 픽커를 켠다. main 이 CDP 로 게스트에 붙어 사용자가 고를 때까지 기다리므로([[main/previewPicker]])
   * 이 호출은 고르거나 취소할 때까지 돌아오지 않는다 — 그동안 화면에 안내줄을 띄운다.
   */
  const pick = async (): Promise<void> => {
    if (!ready || picking) return
    setPicking(true)
    try {
      const { error } = await window.api.preview.pickElement(workspace.id, tabId)
      // 취소는 사용자가 한 일이라 에러로 떠들지 않는다.
      if (error && error !== 'cancelled') pushToast('error', error)
      else if (!error)
        pushToast(
          'success',
          isPaneWindow
            ? 'Element added to the composer in the main window.'
            : 'Element added to the composer.'
        )
    } finally {
      setPicking(false)
    }
  }

  const cancelPick = (): void => {
    if (picking) void window.api.preview.cancelPick(tabId)
  }

  // 픽커를 켠 채 패널이 사라지면(탭·워크스페이스 전환, 창 닫기) main 쪽 CDP 세션이 매달린다.
  // 최신 상태를 ref 로 들고 있다가 언마운트 때 한 번 정리한다.
  const cancelRef = useRef(cancelPick)
  cancelRef.current = cancelPick
  useEffect(() => () => cancelRef.current(), [])

  // 픽커 중 Esc 로 취소. 게스트가 포커스를 쥐고 있으면 이 창의 keydown 이 오지 않을 수 있어
  // 안내줄의 Cancel 버튼도 함께 둔다.
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])

  /**
   * ⌘L(dev·web 탭)이 오면 주소창으로 포커스를 옮긴다. 메뉴 accelerator 로 오는 명령이라
   * `App.tsx` 가 활성 탭 종류를 보고 이 이벤트를 보낼지 결정한다 — 여기서는 그냥 듣기만 한다.
   */
  const addressInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onFocusAddressBar = (): void => {
      addressInputRef.current?.focus()
      addressInputRef.current?.select()
    }
    window.addEventListener(FOCUS_ADDRESS_BAR_EVENT, onFocusAddressBar)
    return () => window.removeEventListener(FOCUS_ADDRESS_BAR_EVENT, onFocusAddressBar)
  }, [])

  /** 지금 화면을 찍어 컴포저에 첨부한다. 이미지는 main 을 거쳐 컴포저가 있는 창으로 간다. */
  const capture = async (): Promise<void> => {
    if (!ready || capturing) return
    setCapturing(true)
    try {
      const { error } = await window.api.preview.capture(workspace.id, tabId)
      if (error) pushToast('error', error)
      else if (isPaneWindow)
        // 이 창에는 컴포저가 없다 — 어디로 갔는지 말해 주지 않으면 아무 일도 안 한 것처럼 보인다.
        pushToast('success', 'Screenshot attached to the composer in the main window.')
      else pushToast('success', 'Screenshot attached to the composer.')
    } finally {
      setCapturing(false)
    }
  }

  const shown = draft ?? url
  const external = url !== '' && !isLocalUrl(url)

  return (
    <div className="h-full flex flex-col min-h-0 bg-[var(--bg)]">
      <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--border)]">
        <NavButton
          label="Back"
          disabled={!nav.back}
          onClick={() => void window.api.views.goBack(tabId)}
          icon={ArrowLeft}
        />
        <NavButton
          label="Forward"
          disabled={!nav.forward}
          onClick={() => void window.api.views.goForward(tabId)}
          icon={ArrowRight}
        />
        <NavButton
          label={loading ? 'Stop' : 'Reload'}
          disabled={!ready || !url}
          onClick={() =>
            loading ? void window.api.views.stop(tabId) : void window.api.views.reload(tabId)
          }
          icon={loading ? X : RotateCw}
        />

        <form onSubmit={submit} className="flex-1 min-w-0 mx-1">
          <input
            ref={addressInputRef}
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setDraft(null)}
            spellCheck={false}
            // 주소 없는 웹 탭은 사용자가 방금 연 빈 탭이다 — 다음 동작이 주소를 치는 것뿐이라
            // 커서를 미리 그 자리에 둔다. dev 탭은 대개 주소가 이미 있어 가로채면 방해가 된다.
            autoFocus={kind === 'web' && !url}
            placeholder={kind === 'web' ? 'Search or type a URL' : 'localhost:3000'}
            aria-label="Preview address"
            className="w-full h-6 px-2 rounded-md bg-[var(--surface-2)] text-xs font-mono text-neutral-200 placeholder:text-neutral-600 outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
          />
        </form>

        {external && (
          <span
            title="This is not a localhost address — Preview is meant for this workspace’s dev server."
            className="shrink-0 grid place-items-center h-6 w-6 text-[var(--warning-400)]"
          >
            <TriangleAlert size={12} />
          </span>
        )}

        {issueCount.errors + issueCount.warnings > 0 && (
          <button
            type="button"
            onClick={toggleIssues}
            aria-pressed={issues !== null}
            title="Console and network errors from this page"
            className={
              'shrink-0 flex items-center gap-1 h-6 px-1.5 rounded-md text-xs tabular-nums ' +
              (issues !== null
                ? 'bg-[var(--surface-3)] text-neutral-100'
                : 'text-neutral-400 hover:bg-[var(--surface-2)]')
            }
          >
            <CircleAlert
              size={12}
              className={
                issueCount.errors ? 'text-[var(--danger-400)]' : 'text-[var(--warning-400)]'
              }
            />
            {issueCount.errors > 0 && <span>{issueCount.errors}</span>}
            {issueCount.warnings > 0 && (
              <span className="text-[var(--warning-400)]">{issueCount.warnings}</span>
            )}
          </button>
        )}

        <NavButton
          label="Pick an element and describe it to the agent"
          disabled={!ready || !url || !active || picking}
          onClick={() => void pick()}
          icon={MousePointerClick}
          activeState={picking}
        />
        <NavButton
          label="Attach a screenshot to the composer"
          disabled={!ready || !url || !active || capturing || picking}
          onClick={() => void capture()}
          icon={capturing ? Loader2 : Camera}
          spin={capturing}
        />
        <NavButton
          label="Open in your browser"
          disabled={!url}
          onClick={() => void window.api.openExternal(url)}
          icon={ExternalLink}
        />
      </div>

      {picking && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--info-500)]/10">
          <MousePointerClick size={12} className="shrink-0 text-[var(--info-400)]" />
          <span className="min-w-0 flex-1 text-xs text-neutral-300">
            Click an element in the preview to describe it to the agent.
          </span>
          <button
            onClick={cancelPick}
            className="shrink-0 text-xs px-2 py-0.5 rounded-md bg-[var(--surface-2)] text-neutral-300 hover:bg-[var(--surface-3)]"
          >
            Cancel
          </button>
        </div>
      )}

      {issues !== null && (
        <IssueList
          issues={issues}
          onSend={() => void sendIssues(issues)}
          onClear={() => {
            void window.api.preview.clearIssues(tabId)
            setIssues(null)
          }}
          onClose={() => setIssues(null)}
        />
      )}

      <div className="relative flex-1 min-h-0 bg-white">
        {/* 자리표시자다. 실제 화면은 main 이 소유한 뷰가 이 사각형 위에 네이티브로 그린다 —
            그래서 여기서 언마운트해도 페이지는 죽지 않고 창에서 떨어지기만 한다. */}
        <div ref={ref} data-hosted-view={tabId} className="absolute inset-0" />
        {!url && <EmptyState kind={kind} />}
        {failure && (
          <FailureState message={failure} onRetry={() => void window.api.views.reload(tabId)} />
        )}
      </div>
    </div>
  )
}

function NavButton({
  label,
  disabled,
  onClick,
  icon: Icon,
  spin,
  activeState
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  icon: React.ComponentType<{ size?: number; className?: string }>
  spin?: boolean
  /** 켜져 있는 모드(요소 픽커)임을 눌린 상태로 보여 준다. */
  activeState?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={activeState}
      disabled={disabled}
      onClick={onClick}
      className={
        'shrink-0 h-6 w-6 grid place-items-center rounded-md disabled:hover:bg-transparent ' +
        (activeState
          ? 'bg-[var(--info-600)] text-white disabled:text-white'
          : 'text-neutral-400 hover:bg-[var(--surface-2)] hover:text-neutral-100 disabled:text-neutral-700')
      }
    >
      <Icon size={13} className={spin ? 'animate-spin' : undefined} />
    </button>
  )
}

/**
 * 모아 둔 콘솔·네트워크 문제 목록.
 *
 * 자동으로 에이전트에게 보내지 않는 것이 요점이다 — dev 서버는 멀쩡히 도는 중에도 경고를 쏟아
 * 내는데, 그게 매번 턴을 소비하면 대화가 잡음으로 덮인다. 무엇을 보낼지는 사람이 정한다.
 */
function IssueList({
  issues,
  onSend,
  onClear,
  onClose
}: {
  issues: PreviewIssue[]
  onSend: () => void
  onClear: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="shrink-0 max-h-56 flex flex-col border-b border-[var(--border)] bg-[var(--bg-2)]">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)]">
        <span className="text-xs text-neutral-400">
          {issues.length} issue{issues.length === 1 ? '' : 's'} from this page
        </span>
        <div className="flex-1" />
        <button
          onClick={onSend}
          disabled={!issues.length}
          className="text-xs px-2 py-0.5 rounded-md bg-[var(--info-600)] text-white hover:bg-[var(--info-500)] disabled:bg-[var(--border)] disabled:text-neutral-600"
        >
          Send to agent
        </button>
        <button
          onClick={onClear}
          title="Clear collected issues"
          className="h-6 w-6 grid place-items-center rounded-md text-neutral-500 hover:bg-[var(--surface-2)] hover:text-neutral-200"
        >
          <Trash2 size={12} />
        </button>
        <button
          onClick={onClose}
          title="Hide"
          className="h-6 w-6 grid place-items-center rounded-md text-neutral-500 hover:bg-[var(--surface-2)] hover:text-neutral-200"
        >
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {issues.length === 0 ? (
          <div className="px-3 py-3 text-xs text-neutral-500">No issues collected.</div>
        ) : (
          issues.map((issue) => (
            <div
              key={issue.id}
              className="flex items-start gap-2 px-3 py-1.5 border-b border-[var(--border)]/40 last:border-0"
            >
              <span
                className={
                  'shrink-0 mt-0.5 text-2xs font-mono uppercase ' +
                  (issue.level === 'error'
                    ? 'text-[var(--danger-400)]'
                    : 'text-[var(--warning-400)]')
                }
              >
                {issue.level === 'error' ? 'err' : 'warn'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-neutral-300 break-words">{issue.text}</div>
                {issue.source && (
                  <div className="text-xs font-mono text-neutral-600 truncate">{issue.source}</div>
                )}
              </div>
              {issue.count > 1 && (
                <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                  ×{issue.count}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/**
 * 안내 화면들은 게스트 자리를 덮어 그린다. 네이티브 뷰는 DOM 위에 그려지므로 덮는 것만으로는
 * 안 보인다 — 그래서 오버레이 자신이 가림을 든다([[lib/viewSuppress]]).
 */
function EmptyState({ kind }: { kind: HostedViewKind }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useSuppressViewsOver(box)
  return (
    <div
      ref={box}
      className="absolute inset-0 grid place-items-center bg-[var(--bg)] px-8 text-center"
    >
      <div className="max-w-sm space-y-2">
        {kind === 'web' ? (
          <>
            <p className="text-sm text-neutral-300">Type an address to start.</p>
            <p className="text-xs leading-relaxed text-neutral-500">
              This tab has its own cookies, separate from your dev server and from your everyday
              browser — signing in here signs in nowhere else.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-300">Nothing to preview yet.</p>
            <p className="text-xs leading-relaxed text-neutral-500">
              Start this workspace’s dev server from the Scripts panel and use “Open in Preview”, or
              type a port (like <span className="font-mono text-neutral-400">3000</span>) in the
              address bar above.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function FailureState({
  message,
  onRetry
}: {
  message: string
  onRetry: () => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useSuppressViewsOver(box)
  return (
    <div
      ref={box}
      className="absolute inset-0 grid place-items-center bg-[var(--bg)] px-8 text-center"
    >
      <div className="max-w-sm space-y-3">
        <p className="text-sm text-neutral-300">Could not load that page.</p>
        <p className="text-xs font-mono text-[var(--danger-400)] break-words">{message}</p>
        <p className="text-xs text-neutral-500">
          The dev server may still be starting up, or it may have stopped.
        </p>
        <button
          onClick={onRetry}
          className="text-xs px-2.5 py-1 rounded-md bg-[var(--surface-2)] text-neutral-200 hover:bg-[var(--surface-3)]"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
