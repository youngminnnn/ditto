# Ditto

병렬 Claude Code 에이전트를 격리된 git worktree 위에서 오케스트레이션하는 데스크톱 앱.
[Conductor](https://conductor.build) 의 컨셉을 따르되 **Claude Code 전용**이며, 새 세션은
**자동 프롬프트 없이 빈 입력창**으로 시작한다.

## 컨셉

- **Repository** — git 리포를 연결한다(메인 체크아웃).
- **Workspace** — 작업 1개 = 전용 git worktree + 브랜치 + Claude Code 세션 1개.
  worktree 는 리포의 형제 디렉토리 `<repo>-worktrees/<branch>` 에 생성된다.
- 각 workspace 의 세션은 **독립적·병렬**로 실행된다. 한 workspace 에서 에이전트가
  돌아가는 동안 다른 workspace 를 열어 작업할 수 있다.
- **Setup / Dev 스크립트** — 리포 단위로 지정(`npm install`, `npm run dev` 등). setup 은
  workspace 생성 시 자동 실행(옵션), dev 는 스크립트 패널에서 실행/중지한다.

## 동작 특징

- **첫 세션에 디폴트 프롬프트 없음** — 입력창은 빈 상태로 시작하고, 사용자가 첫 메시지를
  보낼 때 비로소 세션이 시작된다(자동 실행 없음).
- **Claude Code 전용** — 다른 에이전트는 지원하지 않는다.
- **UI 는 영어** (코드 주석은 한국어 유지).
- **최초 실행 온보딩** — Claude(`claude auth`)·GitHub(`gh auth`) 로그인 안내. 상태/로그인은
  언제든 Settings → Integrations 에서 변경 가능. 로그인 플로우는 Terminal 에서 진행한다.
- **새 workspace 자동 생성** — 이름은 자동 생성, 베이스는 리포 기본 브랜치(main/origin).
  Settings 에서 "직접 입력"을 켜면 이름·베이스 브랜치 입력 모달을 쓴다. workspace 이름은
  헤더에서 더블클릭으로 바꿀 수 있다.
- **Shift+Tab 으로 권한 모드 순환** (Claude Code 와 동일). 현재 모드는 입력창 아래에 표시.
  권한 프롬프트는 Allow/Deny 외에 "Always allow"(이 세션 동안 해당 도구 자동 허용)를 제공하며,
  Enter=Allow / Esc=Deny 단축키를 지원한다.
- **병렬 세션 가시화** — 사이드바에서 실행 중(spinner)·권한 대기(노란 방패)·미확인 응답(파란 점)을
  구분해 보여준다. 창이 비활성이면 완료·에러·권한 대기를 OS 알림으로 띄우고, 입력창 위
  "Needs input / Next unread" 버튼으로 해당 세션으로 바로 이동한다.
- **변경 검토(diff)** — 헤더의 "N changed" 를 누르면 base 브랜치(merge-base) 대비 파일별 diff 를 본다.
  PR 이 없고 커밋이 앞서 있으면 "Create PR"(브라우저 작성 화면)을 노출한다.
- **모델은 workspace 별 오버라이드** 가능(헤더 드롭다운). 미지정 시 전역 설정 모델을 따른다.
- **입력 보존·이어쓰기** — 작성 중 메시지는 workspace 전환에도 유지되고, 실행 중에도 후속 메시지를
  큐에 넣을 수 있다(↑ 로 이전 메시지 불러오기). ⌘1–9 / ⌘[ ⌘] 로 workspace 를 전환한다.
- 인증은 **설치된 Claude Code 의 로그인 정보를 그대로 사용**한다(별도 API 키 불필요).

## 요구 사항

- macOS, Node 20+
- [Claude Code](https://claude.com/claude-code) 가 로그인된 상태 (Agent SDK 가 번들 CLI 로
  실행하며, 자격 증명은 `~/.claude` 를 재사용)
- `git`

## 개발 / 빌드

```sh
npm install
npm run dev        # 개발 모드 (HMR)
npm run typecheck  # 타입 검사 (main + renderer)
npm run build      # 프로덕션 번들 (out/)
npm run dist       # macOS 앱 패키징 (release/)
```

## 아키텍처

Electron + React + TypeScript, electron-vite 빌드.

```
src/
├── shared/          # main↔renderer 공유 타입 + IPC 계약 (SSOT)
│   ├── types.ts
│   └── api.ts       # window.api 표면
├── main/            # Electron 메인 프로세스
│   ├── index.ts     # 앱 생명주기 / 윈도우
│   ├── ipc.ts       # IPC 핸들러 등록
│   ├── store.ts     # 설정 영속화 (userData/ditto.json)
│   ├── transcripts.ts  # workspace 별 대화 기록 영속화
│   ├── git.ts       # worktree / 브랜치 / 상태
│   ├── scripts.ts   # setup/dev 스크립트 실행기
│   └── claude/
│       ├── session.ts   # Agent SDK streaming-input 세션 래퍼
│       ├── manager.ts   # workspace→세션 생명주기 + 권한 라우팅
│       └── asyncQueue.ts
├── preload/         # contextBridge → window.api
└── renderer/        # React UI (zustand 상태)
```

- **세션 구동**: `@anthropic-ai/claude-agent-sdk` 의 `query()` 를 streaming input 으로
  열어 장수명 세션 1개를 유지한다. 사용자 메시지를 입력 큐에 흘려보내 멀티턴 맥락을 유지하고,
  SDK 메시지(`stream_event`/`assistant`/`user`/`result`)를 UI 용 이벤트로 변환한다.
- **권한**: `canUseTool` 콜백을 renderer 로 라우팅해 허용/거부 프롬프트를 띄운다. 권한 모드는
  workspace 별로 선택(확인 요청 / 편집 자동 승인 / 플랜 / 모두 자동 승인).

## 알려진 한계 (v1)

- **앱 재시작 간 세션 resume 미지원** — UI 대화 기록은 영속화되지만, 에이전트 맥락은
  실행마다 새로 시작한다(세션 replay 중복 렌더링을 피하기 위한 결정).
- diff 뷰어는 읽기 전용(스테이징·커밋·되돌리기는 미지원). 라인 단위 구문 강조도 미적용.
