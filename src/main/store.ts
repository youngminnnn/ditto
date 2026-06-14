import { app } from 'electron'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './fsutil'
import { BASE_DEV_PORT } from '@shared/types'
import type { AppState, AppSettings, PermissionMode, Repo, Workspace } from '@shared/types'

const DEFAULT_MODEL = 'claude-opus-4-8[1m]'

/**
 * 디스크 영속 형식의 현재 스키마 버전. 영속 데이터 모양이 바뀔 때마다 1 올리고,
 * MIGRATIONS 에 직전 버전 → 새 버전 변환 함수를 추가한다.
 */
const CURRENT_SCHEMA_VERSION = 4

/** 더 이상 노출하지 않는 'bypassPermissions' 등 옛 모드는 acceptEdits 로 환산한다. */
function normalizeMode(mode: unknown): PermissionMode {
  if (mode === 'default' || mode === 'acceptEdits' || mode === 'plan' || mode === 'auto') return mode
  return 'acceptEdits'
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultPermissionMode: 'default',
  model: DEFAULT_MODEL,
  // null = effort 를 지정하지 않음(모델 기본 동작). 사용자가 Settings 에서 단계를 고르면 그 값으로.
  effort: null,
  // 기본 다크 — 기존 사용자도 load 의 기본값 병합으로 다크를 유지한다.
  theme: 'dark',
  soundOnComplete: true,
  // 우측 작업 패널은 기본 펼침. 기존 사용자도 load 의 기본값 병합으로 펼침을 유지한다.
  defaultRightPanelOpen: true,
  // CLI 와 동일하게 자동 압축을 기본 켜둔다(autoCompactEnabled). 압축을 트리거하는 임계치는
  // 사용자에게 노출하지 않는 내부 상수다(session.ts 의 AUTO_COMPACT_THRESHOLD).
  autoCompact: true,
  manualWorkspaceSetup: false,
  onboarded: false,
  // 미동의(null) 로 시작 — 기존 사용자도 load 의 기본값 병합으로 null 이 되어 (재)동의를 요구한다.
  acceptedTermsVersion: null
}

const EMPTY_STATE: AppState = {
  repos: [],
  workspaces: [],
  settings: DEFAULT_SETTINGS
}

/**
 * 디스크에 기록되는 형식 — 런타임 AppState 에 schemaVersion 을 더한 것.
 * schemaVersion 은 파일 형식 전용이라, IPC 로 노출하는 AppState 에는 싣지 않는다.
 */
type PersistedState = AppState & { schemaVersion: number }

/**
 * 버전별 마이그레이션. 인덱스 v 의 함수가 스키마 v → v+1 변환을 담당한다.
 * 입력은 직전 버전 형식의 파싱된 객체, 출력은 다음 버전 형식의 객체다.
 */
const MIGRATIONS: Array<(raw: Record<string, unknown>) => Record<string, unknown>> = [
  // v0(스키마 버전 필드가 없던 레거시) → v1: 누락·구식 필드를 현재 스키마로 정규화한다.
  (raw) => {
    const settings = { ...DEFAULT_SETTINGS, ...((raw.settings as Partial<AppSettings>) ?? {}) }
    settings.defaultPermissionMode = normalizeMode(settings.defaultPermissionMode)
    // model=null('default') 은 더 이상 노출하지 않으므로 기본 모델로 환산.
    settings.model = settings.model ?? DEFAULT_MODEL

    const workspaces = ((raw.workspaces as Partial<Workspace>[]) ?? []).map((w) => ({
      ...w,
      permissionMode: normalizeMode(w.permissionMode),
      // per-workspace 모델 오버라이드가 없으면 전역 설정을 따른다(null).
      model: w.model ?? null,
      lastModel: w.lastModel ?? null,
      archived: w.archived ?? false
    }))
    const repos = ((raw.repos as Partial<Repo>[]) ?? []).map((r) => ({
      ...r,
      archiveScript: r.archiveScript ?? ''
    }))
    return { repos, workspaces, settings }
  },
  // v1 → v2: 사용자 표시 이름 override(displayName) 도입. 기존 workspace 는 override 없음(null)으로,
  // 기본 규칙(worktree 이름 → PR 제목)을 그대로 따른다.
  (raw) => {
    const workspaces = ((raw.workspaces as Partial<Workspace>[]) ?? []).map((w) => ({
      ...w,
      displayName: w.displayName ?? null
    }))
    return { ...raw, workspaces }
  },
  // v2 → v3: workspace 별 dev 서버 포트(devPort) 도입. 병렬 dev 서버 포트 충돌을 막기 위해
  // 기존 workspace 에도 BASE_DEV_PORT 부터 비어 있는 포트를 하나씩 배정한다(이미 값이 있으면 보존).
  (raw) => {
    const list = (raw.workspaces as Partial<Workspace>[]) ?? []
    const used = new Set<number>()
    for (const w of list) if (typeof w.devPort === 'number') used.add(w.devPort)
    const alloc = (): number => {
      let port = BASE_DEV_PORT
      while (used.has(port)) port++
      used.add(port)
      return port
    }
    const workspaces = list.map((w) => ({
      ...w,
      devPort: typeof w.devPort === 'number' ? w.devPort : alloc()
    }))
    return { ...raw, workspaces }
  },
  // v3 → v4: reasoning effort(추론 노력) 도입. 기존 workspace 는 오버라이드 없음(null)으로 두어
  // 전역 설정(settings.effort)을 따른다. settings.effort 자체는 load 의 기본값 병합으로 null 이 된다.
  (raw) => {
    const workspaces = ((raw.workspaces as Partial<Workspace>[]) ?? []).map((w) => ({
      ...w,
      effort: w.effort ?? null
    }))
    return { ...raw, workspaces }
  }
]

/**
 * 앱 설정(리포·workspace·세팅)을 userData 아래 단일 JSON 파일로 영속화한다.
 * electron-store 대신 직접 둔 이유: 의존성 최소화 + ESM/CJS 마찰 회피.
 * 트랜스크립트(대화 기록)는 용량이 커서 별도 파일로 관리한다([[transcripts]]).
 *
 * 파일에는 schemaVersion 을 함께 기록하고, 로드 시 현재 버전까지 순차 마이그레이션한다.
 */
class Store {
  private filePath: string
  private state: PersistedState

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'ditto.json')
    this.state = this.load()
  }

  private load(): PersistedState {
    if (!existsSync(this.filePath)) return this.empty()
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Record<string, unknown>

      // 버전 필드가 없거나 비정상(음수·소수·비숫자)이면 레거시(v0)로 간주한다.
      const rawVersion = raw.schemaVersion
      let version =
        typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 0
          ? rawVersion
          : 0
      let migrated = raw
      // 현재 버전까지 순차 변환. 파일이 더 높은(미래) 버전이면 루프를 건너뛴다.
      while (version < CURRENT_SCHEMA_VERSION) {
        migrated = MIGRATIONS[version](migrated)
        version++
      }

      // 부팅 시점엔 살아 있는 Claude 세션이 하나도 없다(세션은 첫 메시지 때 lazy 생성).
      // 따라서 직전 종료/크래시 때 'running' 으로 남은 상태는 실제로는 진행되지 않는 유령
      // 상태이므로 idle 로 되돌려, 재시작 후 사이드바가 '진행 중'에 갇히지 않게 한다.
      const workspaces = ((migrated.workspaces as Workspace[]) ?? []).map((w) =>
        w.status === 'running' ? { ...w, status: 'idle' as const } : w
      )

      // 미래 버전 파일(다운그레이드 상황)은 버전을 깎지 않고 보존해, 신버전으로 되돌렸을 때
      // 마이그레이션이 재실행되거나 데이터가 손상되지 않게 한다. 알려진 필드만 읽는다.
      // 마이그레이션 후에도 누락 필드가 없도록 settings 는 기본값과 최종 병합한다.
      return {
        schemaVersion: version,
        repos: (migrated.repos as Repo[]) ?? [],
        workspaces,
        settings: { ...DEFAULT_SETTINGS, ...((migrated.settings as Partial<AppSettings>) ?? {}) }
      }
    } catch {
      // 손상된 설정 파일은 빈 상태로 시작 (앱 기동을 막지 않는다).
      return this.empty()
    }
  }

  private empty(): PersistedState {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, ...structuredClone(EMPTY_STATE) }
  }

  private persist(): void {
    writeFileAtomic(this.filePath, JSON.stringify(this.state, null, 2))
  }

  getState(): AppState {
    // schemaVersion 은 파일 형식 전용이므로 런타임 AppState 에는 싣지 않는다.
    return structuredClone({
      repos: this.state.repos,
      workspaces: this.state.workspaces,
      settings: this.state.settings
    })
  }

  /** mutator 로 state 를 변경하고 즉시 디스크에 기록한다. */
  update(mutate: (state: AppState) => void): void {
    mutate(this.state)
    this.persist()
  }
}

let store: Store | null = null

export function getStore(): Store {
  if (!store) store = new Store()
  return store
}
