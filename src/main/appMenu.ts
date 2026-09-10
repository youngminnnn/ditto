import { Menu, app, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/types'

/**
 * 애플리케이션 메뉴.
 *
 * 이 파일이 생기기 전까지 Wooi 에는 메뉴가 없었고, 그래서 **Electron 의 기본 메뉴가 그대로**
 * 붙어 있었다. 기본 메뉴는 브라우저의 것이라 앱에 맞지 않는 글쇠를 여럿 쥔다:
 *
 * - `⌘R` / `⇧⌘R` — 렌더러를 통째로 새로 읽는다. 대화 스크롤·초안·패널 폭이 날아가고,
 *   사용자 입장에서는 앱이 이유 없이 처음으로 돌아간다. `⇧⌘R` 은 렌더러가 "PR 리뷰" 로
 *   쓰려던 글쇠이기도 해서(`App.tsx`) 그동안 리뷰 대신 강제 새로고침이 걸리고 있었다.
 * - `⌘W` — 창을 닫는다. 탭에게 내줘야 하는 자리다.
 * - `⌘+` / `⌘-` / `⌘0` — 페이지 전체 줌. 대화 글자만 키우려는 `chatFontScale` 과 싸운다.
 *
 * 메뉴 accelerator 는 브라우저 프로세스가 먼저 먹으므로 렌더러의 `preventDefault()` 로는
 * 못 막는다. 그래서 되찾는 방법은 **메뉴를 우리가 까는 것 하나뿐**이다.
 *
 * 우리 항목은 대부분 accelerator 를 달지 않는다. 다는 순간 메뉴가 키를 가로채 렌더러의 문맥
 * 가드(모달이 떠 있으면 양보한다 같은)를 건너뛰게 된다. 글쇠는 계속 렌더러가 소유하고,
 * 메뉴는 "그런 기능이 있다" 를 보여 주는 자리로 둔다. role 항목만 표준 accelerator 를
 * 유지한다 — Edit 메뉴가 그것으로 동작하기 때문이다(아래).
 *
 * **`Tab` 메뉴만 예외다.** 프리뷰·웹 탭 같은 게스트가 포커스를 쥐면 렌더러는 keydown 을 아예
 * 못 본다 — 프리뷰를 한 번 클릭하면 탭 단축키가 통째로 먹통이 된다는 뜻이다. 메뉴 accelerator
 * 는 브라우저 프로세스가 먼저 받으므로 포커스와 무관하게 뜬다. 그 대가로 렌더러의 문맥 가드를
 * 건너뛰므로, `App.tsx` 의 `onMenuCommand` 구독이 모달이 떠 있으면 그 항목들만 걸러 무시한다
 * (한 곳에서 한 번만 검사한다).
 */

/**
 * Edit 메뉴는 반드시 남긴다.
 *
 * macOS 에서 잘라내기·붙여넣기·전체 선택은 이 메뉴의 role 이 굴린다. 없애면 텍스트 입력과
 * 게스트 뷰(프리뷰·웹 탭)의 클립보드가 통째로 죽는다. `⌘Z` 도 여기 남는데, 기본 메뉴에도
 * 있던 것이라 현상 유지다.
 */
function editMenu(): MenuItemConstructorOptions {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' }
    ]
  }
}

/**
 * 개발용 항목은 dev 실행에서만, 그리고 **기본 자리가 아닌 곳에** 둔다.
 *
 * `⌥⌘R` / `⌥⌘I` 로 옮기는 이유는 `⌘R` 과 `⌥⌘I` 를 앱이 쓰기 위해서다. 판정은
 * `windows.ts` 의 로드 분기와 같은 신호를 쓴다 — 기준이 갈리면 한쪽만 dev 로 동작한다.
 */
function developerItems(): MenuItemConstructorOptions[] {
  if (!process.env['ELECTRON_RENDERER_URL']) return []
  return [
    { type: 'separator' },
    { role: 'reload', accelerator: 'Alt+Cmd+R' },
    { role: 'toggleDevTools', accelerator: 'Alt+Cmd+I' }
  ]
}

/**
 * 메뉴를 깔고 화면에 붙인다.
 *
 * `run` 은 명령을 **메인 창으로** 보낸다 — 여기 있는 항목은 전부 메인 창 UI 에 대한 것이고,
 * 분리한 패널 창이 포커스를 쥔 채 메뉴를 골랐을 때 아무 일도 안 일어나면 그건 버그다.
 * 동작을 이 파일이 직접 구현하지 않는 것도 규칙이다 — 구현은 렌더러의 `runPaletteAction`
 * 하나이고, 글쇠·명령 팔레트·메뉴가 그 하나를 함께 부른다.
 */
export function installAppMenu(run: (command: MenuCommand) => void): void {
  const item = (
    label: string,
    command: MenuCommand,
    accelerator?: string
  ): MenuItemConstructorOptions => ({
    label,
    click: () => run(command),
    ...(accelerator ? { accelerator } : {})
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => run('open-settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    editMenu(),
    {
      label: 'View',
      submenu: [
        item('Keyboard Shortcuts', 'open-shortcuts'),
        { type: 'separator' },
        item('Work Panel', 'toggle-work-panel'),
        item('Scripts Panel', 'toggle-scripts-panel'),
        item('Close Focused Pane', 'close-focused-pane'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...developerItems()
      ]
    },
    {
      label: 'Workspace',
      submenu: [
        item('New Workspace', 'new-workspace'),
        item('New Workspace with Agent…', 'new-workspace-choose-agent'),
        { type: 'separator' },
        item('Search Conversations…', 'search-conversations'),
        item('Open File…', 'open-file'),
        { type: 'separator' },
        item('Review a Pull Request…', 'review-pull-request'),
        item('Lay Out the Stack', 'open-stack-view'),
        { type: 'separator' },
        item('Open in Editor', 'open-in-editor'),
        item('Reveal in Finder', 'reveal-in-finder'),
        item('Export Conversation…', 'export-conversation'),
        { type: 'separator' },
        item('Archive Workspace', 'archive-workspace')
      ]
    },
    {
      // 워크스페이스 콘텐츠 영역 맨 위 탭 스트립(TabStrip)과 그 안의 dev·web 탭 페이지 이동.
      // 이 메뉴의 항목에는 전부 accelerator 가 있다 — 위 파일 주석의 예외.
      label: 'Tab',
      submenu: [
        item('New Tab', 'new-tab', 'Cmd+T'),
        item('Close Tab', 'close-tab', 'Cmd+W'),
        item('Reopen Closed Tab', 'reopen-closed-tab', 'Shift+Cmd+T'),
        { type: 'separator' },
        item('Select Next Tab', 'next-tab', 'Shift+Cmd+]'),
        item('Select Previous Tab', 'previous-tab', 'Shift+Cmd+['),
        { type: 'separator' },
        // ⌘1 은 언제나 작업 탭(Work) — TabStrip 이 그 탭을 항상 index 0 에 고정하는 불변식과
        // 같다([[main/workspaceTabs]]). 숫자 하나마다 항목을 두는 것도 accelerator 하나마다
        // Electron 메뉴 항목이 있어야 하기 때문이다 — 클릭할 일은 거의 없어도 등록은 필요하다.
        item('Select Tab 1', 'select-tab-1', 'Cmd+1'),
        item('Select Tab 2', 'select-tab-2', 'Cmd+2'),
        item('Select Tab 3', 'select-tab-3', 'Cmd+3'),
        item('Select Tab 4', 'select-tab-4', 'Cmd+4'),
        item('Select Tab 5', 'select-tab-5', 'Cmd+5'),
        item('Select Tab 6', 'select-tab-6', 'Cmd+6'),
        item('Select Tab 7', 'select-tab-7', 'Cmd+7'),
        item('Select Tab 8', 'select-tab-8', 'Cmd+8'),
        item('Select Tab 9', 'select-tab-9', 'Cmd+9'),
        { type: 'separator' },
        item('Reload Tab', 'reload-tab', 'Cmd+R'),
        item('Back', 'page-back', 'Cmd+['),
        item('Forward', 'page-forward', 'Cmd+]'),
        { type: 'separator' },
        item('Focus Address Bar', 'focus-address-bar', 'Cmd+L')
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        // accelerator 없이 둔다 — `⌘W` 는 탭이 가져간다. 창은 신호등 버튼과 `⌘Q` 로 닫는다.
        { role: 'close', accelerator: '' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
