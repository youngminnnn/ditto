import { app } from 'electron'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './fsutil'
import type { AppState, AppSettings, PermissionMode, Repo, Workspace } from '@shared/types'

const DEFAULT_MODEL = 'claude-opus-4-8[1m]'

/** 더 이상 노출하지 않는 'bypassPermissions' 등 옛 모드는 acceptEdits 로 환산한다. */
function normalizeMode(mode: unknown): PermissionMode {
  if (mode === 'default' || mode === 'acceptEdits' || mode === 'plan' || mode === 'auto') return mode
  return 'acceptEdits'
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultPermissionMode: 'default',
  model: DEFAULT_MODEL,
  soundOnComplete: true,
  manualWorkspaceSetup: false,
  onboarded: false
}

const EMPTY_STATE: AppState = {
  repos: [],
  workspaces: [],
  settings: DEFAULT_SETTINGS
}

/**
 * 앱 설정(리포·workspace·세팅)을 userData 아래 단일 JSON 파일로 영속화한다.
 * electron-store 대신 직접 둔 이유: 의존성 최소화 + ESM/CJS 마찰 회피.
 * 트랜스크립트(대화 기록)는 용량이 커서 별도 파일로 관리한다([[transcripts]]).
 */
class Store {
  private filePath: string
  private state: AppState

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'ditto.json')
    this.state = this.load()
  }

  private load(): AppState {
    if (!existsSync(this.filePath)) return structuredClone(EMPTY_STATE)
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<AppState>
      const settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }
      settings.defaultPermissionMode = normalizeMode(settings.defaultPermissionMode)
      // 옛 스키마: model=null('default') 은 더 이상 노출하지 않으므로 기본 모델로 환산.
      settings.model = settings.model ?? DEFAULT_MODEL
      // 옛 스키마(archived/lastModel 누락, bypassPermissions 모드)를 정규화한다.
      const workspaces = (raw.workspaces ?? []).map(
        (w): Workspace => ({
          ...w,
          permissionMode: normalizeMode(w.permissionMode),
          // 옛 스키마: per-workspace 모델 오버라이드가 없으면 전역 설정을 따른다(null).
          model: w.model ?? null,
          lastModel: w.lastModel ?? null,
          archived: w.archived ?? false
        })
      )
      // 옛 리포에 archiveScript 가 없으면 빈 문자열로 보강.
      const repos = (raw.repos ?? []).map((r): Repo => ({ ...r, archiveScript: r.archiveScript ?? '' }))
      return { repos, workspaces, settings }
    } catch {
      // 손상된 설정 파일은 빈 상태로 시작 (앱 기동을 막지 않는다).
      return structuredClone(EMPTY_STATE)
    }
  }

  private persist(): void {
    writeFileAtomic(this.filePath, JSON.stringify(this.state, null, 2))
  }

  getState(): AppState {
    return structuredClone(this.state)
  }

  /** mutator 로 state 를 변경하고 즉시 디스크에 기록한다. */
  update(mutate: (state: AppState) => void): AppState {
    mutate(this.state)
    this.persist()
    return this.getState()
  }
}

let store: Store | null = null

export function getStore(): Store {
  if (!store) store = new Store()
  return store
}
