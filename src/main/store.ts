import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState, AppSettings } from '@shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  defaultPermissionMode: 'acceptEdits',
  autoRunSetup: true,
  model: null
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
      return {
        repos: raw.repos ?? [],
        workspaces: raw.workspaces ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }
      }
    } catch {
      // 손상된 설정 파일은 빈 상태로 시작 (앱 기동을 막지 않는다).
      return structuredClone(EMPTY_STATE)
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8')
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
