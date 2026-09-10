/**
 * 앱 전체 단축키의 **정본**. 도움말 모달(`ShortcutsHelp`)과 명령 팔레트(`QuickSwitcher`)가
 * 둘 다 여기를 읽는다.
 *
 * 라벨을 팔레트용으로 복제하지 않는 이유는 단순하다 — 복제한 순간 한쪽만 고쳐지고, 그때부터
 * 도움말과 팔레트가 서로 다른 앱을 설명하게 된다. 목록이 하나면 어긋날 자리가 없다.
 * `commandPalette.test` 가 이 배열의 모든 항목이 팔레트 인덱스에 들어오는지 지킨다.
 */

/**
 * 팔레트에서 **실행할 수 있는** 동작의 이름.
 *
 * 단축키가 있다고 전부 여기 오지는 않는다. `⏎ 전송`·`⇧⏎ 줄바꿈` 같은 타건 제스처와
 * `⌥⌘↑ / ⌥⌘↓` 처럼 한 줄이 두 방향을 함께 설명하는 항목은 "누를 수는 있어도 고를 수는 없는"
 * 것들이라, 팔레트에서는 참조 행으로만 남는다(검색은 되고 Enter 는 듣지 않는다).
 *
 * 실제 구현은 `App.tsx` 가 들고 있다 — 전역 keydown 과 팔레트가 **같은 함수**를 부른다.
 */
export type PaletteActionId =
  | 'open-shortcuts'
  | 'search-conversations'
  | 'next-unread'
  | 'next-needs-input'
  | 'new-workspace'
  | 'new-workspace-choose-agent'
  | 'undo-workspace-action'
  | 'reopen-archived'
  | 'review-pull-request'
  | 'open-stack-view'
  | 'rebase-onto-base'
  | 'open-settings'
  | 'toggle-work-panel'
  | 'toggle-scripts-panel'
  | 'toggle-dev-script'
  | 'cycle-permission-mode'
  | 'approve-all-permissions'
  | 'open-file'
  | 'open-in-editor'
  | 'reveal-in-finder'
  | 'export-conversation'
  | 'archive-workspace'
  | 'delete-workspace'
  | 'focus-composer'
  | 'toggle-tool-results'
  | 'cycle-subagent'
  | 'close-focused-pane'
  | 'toggle-split-focus'
  // 탭 스트립(TabStrip). 게스트(프리뷰·웹 탭)가 포커스를 쥐면 렌더러는 keydown 을 아예 못
  // 보므로, 이 동작들의 진짜 글쇠는 App.tsx 의 keydown 이 아니라 메뉴 accelerator 다
  // (`src/main/appMenu.ts` 의 Tab 메뉴). 팔레트·도움말에서는 다른 동작과 똑같이 보인다 —
  // 입구가 메뉴라는 사실은 사용자가 몰라도 되는 구현 디테일이다.
  | 'new-tab'
  | 'close-tab'
  | 'reopen-closed-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'select-tab-1'
  | 'select-tab-2'
  | 'select-tab-3'
  | 'select-tab-4'
  | 'select-tab-5'
  | 'select-tab-6'
  | 'select-tab-7'
  | 'select-tab-8'
  | 'select-tab-9'
  | 'reload-tab'
  | 'page-back'
  | 'page-forward'
  | 'focus-address-bar'

export interface ShortcutItem {
  /** 도움말에 그리는 글쇠들. `–` 와 `/` 는 kbd 가 아니라 구분 기호로 그려진다. */
  keys: string[]
  label: string
  /** 팔레트에서 고를 수 있는 동작이면 그 이름. 없으면 검색만 되는 참조 행이다. */
  action?: PaletteActionId
}

export interface ShortcutGroup {
  title: string
  items: ShortcutItem[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['⌘K'], label: 'Quick switcher — search any workspace' },
      {
        keys: ['⇧⌘K'],
        label: 'Search conversations across every workspace',
        action: 'search-conversations'
      },
      { keys: ['⌥⌘1', '–', '⌥⌘9'], label: 'Switch to the top 9 workspaces in the sidebar' },
      // 예전엔 ⌘↑/⌘↓ 였다. 맨 글쇠(⌘1–9·⌘[/]·⌘R…)는 이제 탭·페이지 단축키가 메뉴 accelerator 로
      // 가져갔으므로(게스트가 포커스를 쥐어도 떠야 해서), 워크스페이스 쪽은 ⌥ 를 더해 자리를
      // 비켜 줬다. PR 리뷰 화면에서는 같은 글쇠(⌥⌘↑/⌥⌘↓)를 코멘트 이동이 쓴다 — 리뷰가 떠 있으면
      // 리뷰 쪽이 이긴다.
      { keys: ['⌥⌘↑', '/', '⌥⌘↓'], label: 'Previous / next workspace' },
      { keys: ['⌥⌘[', '/', '⌥⌘]'], label: 'Back / forward through workspaces you visited' },
      { keys: ['⌘U'], label: 'Jump to next unread session', action: 'next-unread' },
      { keys: ['⌘I'], label: 'Jump to next session needing input', action: 'next-needs-input' },
      { keys: ['?'], label: 'Show keyboard shortcuts', action: 'open-shortcuts' }
    ]
  },
  {
    title: 'Session & panels',
    items: [
      { keys: ['⌘N'], label: 'New workspace in the focused repository', action: 'new-workspace' },
      {
        keys: ['⇧⌘N'],
        label: 'Choose an agent for a new workspace',
        action: 'new-workspace-choose-agent'
      },
      {
        keys: ['⌘Z'],
        label: 'Undo — delete the workspace you just created',
        action: 'undo-workspace-action'
      },
      {
        // 예전엔 ⇧⌘T 였다. 그 글쇠는 이제 메뉴 accelerator 가 "닫은 탭 다시 열기" 로 가져갔다
        // (아래 Tabs 그룹의 reopen-closed-tab).
        keys: ['⇧⌘Z'],
        label: 'Reopen the workspace you just archived',
        action: 'reopen-archived'
      },
      { keys: ['⇧⌘R'], label: 'Review a pull request', action: 'review-pull-request' },
      {
        keys: ['⇧⌘L'],
        label: 'Lay out the whole stack of the selected workspace',
        action: 'open-stack-view'
      },
      {
        keys: ['⇧⌘B'],
        label: 'Rebase the workspace onto its base branch',
        action: 'rebase-onto-base'
      },
      { keys: ['⌘,'], label: 'Open settings', action: 'open-settings' },
      // 예전엔 ⌘J 였다. 탭·페이지 단축키가 ⌘ 맨 글쇠들을 메뉴 accelerator 로 가져가면서 함께 옮겼다.
      { keys: ['⌥⌘J'], label: 'Toggle the work panel', action: 'toggle-work-panel' },
      {
        keys: ['⌃A'],
        label: 'Step through this workspace’s subagents, then back to the main conversation',
        action: 'cycle-subagent'
      },
      { keys: ['⇧⌘S'], label: 'Toggle the scripts panel', action: 'toggle-scripts-panel' },
      { keys: ['⇧⌘D'], label: 'Run / stop the dev script', action: 'toggle-dev-script' },
      { keys: ['⇧⇥'], label: 'Cycle permission mode', action: 'cycle-permission-mode' },
      {
        keys: ['⇧⌘A'],
        label: 'Approve all pending permissions',
        action: 'approve-all-permissions'
      }
    ]
  },
  {
    // 이 그룹의 글쇠는 전부 메뉴 accelerator 로 달려 있다(App.tsx 의 keydown 이 아니다) —
    // 게스트(프리뷰·웹 탭)가 포커스를 쥐면 렌더러는 keydown 을 아예 못 보므로, 브라우저
    // 프로세스가 먼저 받는 메뉴 accelerator 만 포커스와 무관하게 뜬다.
    title: 'Tabs',
    items: [
      { keys: ['⌘T'], label: 'New tab', action: 'new-tab' },
      { keys: ['⌘W'], label: 'Close the active tab', action: 'close-tab' },
      { keys: ['⇧⌘T'], label: 'Reopen the tab you just closed', action: 'reopen-closed-tab' },
      { keys: ['⇧⌘]'], label: 'Next tab', action: 'next-tab' },
      { keys: ['⇧⌘['], label: 'Previous tab', action: 'previous-tab' },
      {
        keys: ['⌘1', '–', '⌘9'],
        label: 'Switch to a tab by position (⌘1 is always Work)'
      },
      { keys: ['⌘R'], label: 'Reload the tab (dev / web tabs only)', action: 'reload-tab' },
      {
        keys: ['⌘['],
        label: 'Back on the page (dev / web tabs only)',
        action: 'page-back'
      },
      {
        keys: ['⌘]'],
        label: 'Forward on the page (dev / web tabs only)',
        action: 'page-forward'
      },
      {
        keys: ['⌘L'],
        label: 'Focus the address bar (dev / web tabs) or the message input',
        action: 'focus-address-bar'
      }
    ]
  },
  {
    title: 'Side by side',
    items: [
      {
        // 키가 아니라 마우스 관용구라 팔레트가 대신 눌러 줄 수 없다 — 참조 행으로 둔다.
        keys: ['⌘-click'],
        label: 'Open another layer of the same stack — or a review — beside what you have open'
      },
      { keys: ['⌘\\'], label: 'Move focus to the other pane', action: 'toggle-split-focus' },
      { keys: ['⇧⌘W'], label: 'Close the focused pane', action: 'close-focused-pane' }
    ]
  },
  {
    title: 'Workspace tools',
    items: [
      { keys: ['⇧⌘O'], label: 'Open a file in the big viewer', action: 'open-file' },
      { keys: ['⇧⌘E'], label: 'Open workspace in editor', action: 'open-in-editor' },
      { keys: ['⇧⌘F'], label: 'Reveal workspace in Finder', action: 'reveal-in-finder' },
      { keys: ['⇧⌘X'], label: 'Export conversation', action: 'export-conversation' },
      {
        keys: ['⇧⌘⌫'],
        label: 'Archive workspace — or the review you have open',
        action: 'archive-workspace'
      },
      {
        keys: ['⌥⌘⌫'],
        label: 'Delete workspace for good — worktree, branch and history',
        action: 'delete-workspace'
      }
    ]
  },
  {
    title: 'Terminal tabs',
    items: [
      { keys: ['⌃⇧T'], label: 'New terminal tab' },
      { keys: ['⌃⇧W'], label: 'Close the terminal tab you are on' },
      { keys: ['⌃⇥', '/', '⇧⌃⇥'], label: 'Next / previous terminal tab' },
      { keys: ['Double-click'], label: 'Rename a tab' }
    ]
  },
  {
    title: 'File viewer',
    items: [
      {
        keys: ['⇧⌘O'],
        label: 'Open a file — type a path, add #L42 to jump to a line',
        action: 'open-file'
      },
      // 파일마다 탭이 하나라 방문 기록이 곧 탭 목록이다 — 앞/뒤 이력은 없고, 닫기는 다른
      // 탭과 똑같이 ⌘W 다(따로 적지 않는다).
      { keys: ['⌘F'], label: 'Find in the open file — only while a file tab is active' }
    ]
  },
  {
    title: 'Changes',
    items: [
      { keys: ['F7'], label: 'Jump to the next change in the diff' },
      { keys: ['⇧F7'], label: 'Jump to the previous change in the diff' }
    ]
  },
  {
    title: 'Pull request review',
    items: [
      { keys: ['⇧⌘R'], label: 'Review a pull request', action: 'review-pull-request' },
      { keys: ['n', '/', 'p'], label: 'Next / previous comment on the diff' },
      { keys: ['⌥⌘↓', '/', '⌥⌘↑'], label: 'Next / previous comment — same thing, with modifiers' },
      { keys: ['⇧⌘⌫'], label: 'Archive the review you have open', action: 'archive-workspace' }
    ]
  },
  {
    title: 'Conversation',
    items: [
      // ⌘L 은 이제 Tabs 그룹에 있다 — dev·web 탭에서는 주소창, 아니면 이 입력창을 포커스한다
      // (focus-address-bar). 같은 물리 키를 두 행으로 쪼개면 "정본이 둘" 이 되므로 여기서는 뺀다.
      { keys: ['⌘F'], label: 'Search the conversation' },
      { keys: ['⌘+', '/', '⌘-'], label: 'Bigger / smaller conversation text' },
      { keys: ['⌘0'], label: 'Reset conversation text size' },
      {
        keys: ['⌃O'],
        label: 'Cycle density: Summary → Normal → Verbose',
        action: 'toggle-tool-results'
      },
      { keys: ['⇧⌘↓'], label: 'Jump to the latest message' },
      { keys: ['↑', '/', '↓'], label: 'Recall previous messages (in the input box)' },
      { keys: ['⏎'], label: 'Send message — reaches the agent even while a turn is running' },
      { keys: ['⌘⏎'], label: 'Stop the current turn and send the message now' },
      { keys: ['⇧⏎'], label: 'New line' },
      { keys: ['Esc'], label: 'Stop the current turn — or close a card / deny a permission' },
      { keys: ['Esc', 'Esc'], label: 'Rewind — roll code and/or chat back to an earlier message' },
      { keys: ['#'], label: 'Start a message with # to save it to CLAUDE.md' }
    ]
  }
]
