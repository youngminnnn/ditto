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
- **최초 실행 온보딩** — ① 약관·개인정보처리방침 **동의**(미동의 시 진행 불가) → ② Claude
  (`claude auth`)·GitHub(`gh auth`) 로그인 안내. CLI 가 설치돼 있지 않으면 설치 링크를 노출한다.
  상태/로그인은 언제든 Settings → Integrations 에서 변경 가능하며, 로그인 플로우는 Terminal 에서 진행한다.
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

## 개인정보 / 데이터

- Ditto 는 자체 서버가 없고 **분석/텔레메트리를 수집하지 않는다**.
- 프롬프트·코드는 Claude Agent SDK 를 통해 **Anthropic** 으로, PR 기능 사용 시 메타데이터가
  `gh` CLI 를 통해 **GitHub** 으로 전송된다. 설정·대화 기록은 **로컬**(`~/Library/Application Support/Ditto/`)에만 저장된다.
- 상세는 [`PRIVACY.md`](./PRIVACY.md) · [`TERMS.md`](./TERMS.md) 참고. (둘 다 법무 검토 전 초안)

## 요구 사항

- macOS, Node 20+
- [Claude Code](https://claude.com/claude-code) — 필수. 로그인된 상태(Agent SDK 가 번들 CLI 로
  실행하며, 자격 증명은 `~/.claude` 를 재사용). 미설치 시 온보딩에서 설치 링크를 안내한다.
- `gh`(GitHub CLI) — 선택. PR 조회/생성 기능에만 필요.
- `git`

## 개발 / 빌드

```sh
npm install
npm run dev        # 개발 모드 (HMR)
npm run typecheck  # 타입 검사 (main + renderer)
npm run build      # 프로덕션 번들 (out/)
npm run dist       # macOS dmg + zip 패키징, 미서명 (release/)
```

### 배포 빌드 (dmg)

- **로컬 dmg 빌드는 디스크 이미지를 `/Volumes` 에 마운트**하므로, 매체제어/DLP(예: Office Keeper)
  환경에서는 마운트가 차단돼 dmg 패키징이 실패할 수 있다. 이 경우 **CI 빌드를 권장**한다.
  (`zip` 타깃은 마운트가 없어 로컬에서도 생성·실행이 가능하다.)
- **GitHub Actions** — `.github/workflows/build.yml` 이 `macos-14`(Apple Silicon) 러너에서
  미서명 dmg/zip 을 빌드해 artifact 로 올린다. **수동(`workflow_dispatch`)** 또는 **`v*` 태그 push**
  로만 트리거한다(private repo 의 macOS 러너는 분당 과금이 크다). 결과물은 Actions 실행 페이지의
  **Artifacts** 또는 `gh run download <run-id> --name ditto-macos-arm64` 로 받는다.

## 아키텍처

Electron + React + TypeScript, electron-vite 빌드.

```
src/
├── shared/          # main↔renderer 공유 타입 + IPC 계약 (SSOT)
│   ├── types.ts
│   └── api.ts       # window.api 표면
├── main/            # Electron 메인 프로세스
│   ├── index.ts     # 앱 생명주기 / 윈도우 / 프로덕션 CSP
│   ├── ipc.ts       # IPC 핸들러 등록
│   ├── store.ts     # 설정 영속화 (userData/ditto.json, 스키마 버전 마이그레이션)
│   ├── transcripts.ts  # workspace 별 대화 기록 (JSONL append-only + LRU 캐시)
│   ├── fsutil.ts    # 원자적 파일 쓰기 (temp + rename)
│   ├── git.ts       # worktree / 브랜치 / 상태
│   ├── github.ts    # gh CLI 기반 PR 상태/생성
│   ├── auth.ts      # claude/gh 설치·로그인 상태
│   ├── scripts.ts   # setup/dev 스크립트 실행기 (프로세스 그룹 종료)
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
- **데이터 안정성**: 설정·트랜스크립트는 [`fsutil`](src/main/fsutil.ts) 의 원자적 쓰기로 저장하고,
  설정 파일은 `schemaVersion` 기반으로 로드 시 마이그레이션한다. 프로덕션 빌드에는 엄격한 CSP 를
  응답 헤더로 주입한다(`script-src 'self'`).

## 알려진 한계 (v1)

- **앱 재시작 간 세션 resume 미지원** — UI 대화 기록은 영속화되지만, 에이전트 맥락은
  실행마다 새로 시작한다(세션 replay 중복 렌더링을 피하기 위한 결정).
- diff 뷰어는 읽기 전용(스테이징·커밋·되돌리기는 미지원). 라인 단위 구문 강조도 미적용.
- 빌드 산출물은 **arm64(Apple Silicon) 단일**이며 **미서명**이다. 외부 배포에는 서명·공증이 필요하다(아래 로드맵).

## 다음 단계 (외부 배포 로드맵)

상용(무료·외부 다운로드) 배포까지 남은 작업:

1. **코드 서명 + 공증** — Apple Developer Program 가입 → Developer ID Application 인증서 발급 →
   repo Secrets(`CSC_LINK`, `CSC_KEY_PASSWORD`, 공증용 `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`)로
   주입 → workflow 의 빌드 step 에서 서명·공증(hardened runtime + entitlements)을 켠다.
   **이게 있어야 웹에서 받은 dmg 가 Gatekeeper 를 통과**한다(무료 앱도 동일).
2. **릴리스 자동 첨부 + 자동 업데이트** — 인증서 준비 후 `--publish always` + 토큰으로 `v*` 태그
   push 시 GitHub Release 에 dmg/zip 을 올리고, `electron-updater` + `latest-mac.yml` 로 자동 업데이트를 연결한다.
3. **배포 전 마무리** —
   - `PRIVACY.md`·`TERMS.md`·`OnboardingModal.tsx` 의 placeholder URL(`github.com/ditto-app/ditto`)을
     **공개 접근 가능한 실제 문서 URL**로 교체(private repo 링크는 일반 사용자가 못 본다).
   - 두 문서의 `Contact` 정보, `package.json` 의 `author` 등 메타데이터 채우기.
   - 약관/개인정보처리방침 법무 검토.
4. **(선택)** universal(arm64 + x64) 빌드, GitHub Actions 의 Node 24 런타임 대응(actions 버전 갱신),
   파일 로깅·CLI 미설치 진단 강화.

## 라이선스

독점(proprietary) 소프트웨어. 무료로 설치·사용할 수 있으나 재배포·역공학은 허용되지 않는다.
자세한 내용은 [`TERMS.md`](./TERMS.md) 참고.
