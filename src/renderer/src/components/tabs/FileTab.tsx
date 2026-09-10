import { useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, RotateCw } from 'lucide-react'
import Composer from '../Composer'
import FileViewer from '../files/FileViewer'
import FileEditControls from '../files/FileEditControls'
import { useFileEditor } from '../files/useFileEditor'
import { registerUnsavedPaths } from '../../lib/tabCloseGuard'
import { selectedLineRange } from '../files/lineRange'
import { languageOf } from '../../lib/highlight'
import { useStore } from '../../store'
import { appendMention, mentionWithRange } from '../../lib/mention'
import type { FileContent, Workspace } from '@shared/types'

/**
 * 파일 하나를 보여주는 탭.
 *
 * 예전에는 대화 위를 덮는 오버레이([[FileViewerOverlay]])였고, 그 오버레이가 브라우저처럼
 * 앞/뒤로 오갈 수 있는 방문 기록을 스스로 들고 있었다. 탭 스트립이 생긴 지금은 "열어 둔
 * 파일들" 자체가 곧 탭 목록이라 — 다른 파일을 보고 싶으면 그 탭으로 가면 되고, 다시 이
 * 파일로 돌아오고 싶으면 이 탭을 다시 누르면 된다 — 이력을 따로 둘 이유가 없다.
 *
 * 왼쪽에 파일 트리도 넣지 않는다. 트리는 이미 우측 작업 패널의 All files(FileBrowser)에
 * 있고, 다른 파일을 찾는 길은 퀵 오픈(⇧⌘O)이다. 탭마다 트리를 하나씩 두면 같은 트리가
 * 화면에 여럿 떠 있는 꼴이 된다.
 *
 * BrowserTab 과 같은 이유로 컴포저도 그린다 — 파일을 보면서 "이 함수 고쳐줘" 라고 말할
 * 데가 있어야 이 화면의 목적이 완성된다. 초안(drafts)·첨부(composerAttachments)는 스토어에
 * 워크스페이스 단위로 있어 탭을 오가도 그대로 남는다.
 *
 * **의도적으로 `key` 를 이 컴포넌트에 걸지 않는다**(App.tsx 참고). `useFileEditor` 는 초안을
 * 경로별로 들고 있어 파일 탭 사이를 오가는 동안 고치던 내용을 잃지 않는데, BrowserTab 처럼
 * `key={tab.id}` 를 걸면 탭을 바꿀 때마다 이 컴포넌트가 통째로 리마운트되어 그 딕셔너리가
 * 매번 비워진다. Work 탭으로 나갔다 돌아오면 어차피 이 컴포넌트 자체가 트리에서 빠졌다 붙으니
 * 리마운트되지만(=초안을 잃는다), 그건 예전 오버레이를 닫았다 다시 여는 것과 같은 지점이라
 * 새로 생긴 손실이 아니다.
 */
export default function FileTab({
  workspace,
  path,
  nav
}: {
  workspace: Workspace
  /** 이 탭이 가리키는 파일의 워크트리 상대 경로(main 이 탭의 target 으로 들고 있다). */
  path: string
  /** `openFileViewer` 가 보낸 이동 명령(주로 줄 번호). 다른 파일을 향한 것이면 무시한다. */
  nav: { path: string; line?: number; seq: number } | null
}): React.JSX.Element {
  const setDraft = useStore((s) => s.setDraft)
  const pushToast = useStore((s) => s.pushToast)

  const [content, setContent] = useState<FileContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  // 새로고침 시 본문을 다시 읽기 위한 카운터(에이전트가 방금 고친 파일을 그 자리에서 확인).
  const [reloadKey, setReloadKey] = useState(0)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setContent(null)
    void window.api.fs.read(workspace.id, path).then((c) => {
      if (!alive) return
      setContent(c)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [workspace.id, path, reloadKey])

  const editor = useFileEditor({
    workspaceId: workspace.id,
    path,
    content,
    onContent: setContent
  })

  // 저장하지 않은 경로를 닫기 경로가 볼 수 있게 내놓는다([[lib/tabCloseGuard]]).
  //
  // 여기서 "닫아도 되나" 를 판정하지 않는 이유: 이 컴포넌트는 인스턴스 하나가 경로를 갈아
  // 끼우며 살아서 **지금 보고 있지 않은 파일의 편집도** 들고 있다. 판정을 여기서 하면 그 탭을
  // 닫을 때 아무도 묻지 않는다. 아는 것(어느 경로가 더럽나)만 말하고, 대조는 탭을 닫는 쪽이 한다.
  const dirtyRef = useRef<string[]>([])
  dirtyRef.current = editor.dirtyPaths
  useEffect(() => registerUnsavedPaths(() => dirtyRef.current), [])

  // 파일이 바뀌면 검색바는 접는다 — 이전 파일에서 찾던 말이 그대로 남아 있으면 혼란스럽다.
  useEffect(() => setSearchOpen(false), [path])

  // 줄 번호가 붙은 이동 명령은 **이 탭이 가리키는 파일을 향한 것일 때만** 받는다 — fileNav 는
  // 스토어에 하나뿐이라 다른 파일 탭이 열려 있어도 이 값은 그쪽을 가리킬 수 있다.
  const focusLine = nav?.path === path ? nav.line : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 위에 confirm 이나 팔레트가 떠 있으면 그쪽이 먼저다.
      if (useStore.getState().confirmState) return
      if (!e.metaKey) return
      // ⌘S: 저장. 편집 중이 아니면 아무 일도 없다.
      if (e.code === 'KeyS' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (editor.editing && editor.dirty && !editor.saving) void editor.save()
        return
      }
      // ⌘E: 편집 시작. ⇧⌘E 는 외부 에디터로 여는 기존 단축키라 건드리지 않는다.
      if (e.code === 'KeyE' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (!editor.editing) editor.begin()
        return
      }
      // ⌘F: 파일 내 검색. 이 리스너는 파일 탭이 화면에 떠 있는 동안만 살아 있다 — Work 탭으로
      // 돌아가면 이 컴포넌트가 언마운트되며 리스너도 함께 사라지므로, 대화 검색(MessageList)의
      // ⌘F 와 부딪힐 일이 없다. 파일 탭이 이기게 하려고 따로 막을 것이 없는 이유다.
      if (e.code === 'KeyF' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])

  /**
   * 보고 있는 파일을 입력창 초안에 `@멘션` 으로 붙인다. 본문을 드래그해 뒀으면
   * `#L시작-끝` 범위로 좁혀 넣는다.
   */
  const mention = (): void => {
    const range = content?.binary ? null : selectedLineRange(preRef.current, content?.text ?? '')
    const token = mentionWithRange(path, range?.from, range?.to)
    const draft = useStore.getState().drafts[workspace.id] ?? ''
    setDraft(workspace.id, appendMention(draft, token))
    pushToast('info', `Added ${token.trim()} to the message box`)
  }

  // 경로 옆에 붙이는 언어·줄 수 — 파일이 어떤 것인지 열자마자 눈에 들어온다.
  const meta = useMemo(() => {
    if (!content || content.binary) return null
    const lines = content.text ? content.text.split('\n').length : 0
    return `${languageOf(path) ?? 'Plain text'} · ${lines} line${lines === 1 ? '' : 's'}`
  }, [content, path])

  const iconBtn =
    'shrink-0 flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-100 px-1.5 py-0.5 rounded hover:bg-[var(--surface-2)]'

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div className="h-7 shrink-0 flex items-center gap-2 px-2 border-b border-[var(--border)]">
        <span className="min-w-0 flex-1 truncate text-xs font-mono text-neutral-300" title={path}>
          {path}
        </span>
        {meta && <span className="shrink-0 text-2xs text-neutral-500">{meta}</span>}
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className={iconBtn}
          title="Reload this file from disk"
        >
          <RotateCw size={12} />
        </button>
        <button
          onClick={mention}
          className={iconBtn}
          title="Mention this file in the message box (select lines first to mention just that range)"
        >
          <AtSign size={12} /> Mention
        </button>
        <FileEditControls editor={editor} compact />
      </div>
      <FileViewer
        key={path}
        content={content}
        loading={loading}
        preRef={preRef}
        density="comfortable"
        focusLine={focusLine}
        searchOpen={searchOpen}
        onCloseSearch={() => setSearchOpen(false)}
        editor={editor}
      />
      <Composer workspace={workspace} />
    </div>
  )
}
