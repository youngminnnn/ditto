import { app } from 'electron'
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './fsutil'
import type { ChatItem } from '@shared/types'

/**
 * workspace 별 대화 기록을 파일로 영속화한다.
 * 설정 파일([[store]])과 분리한 이유는 트랜스크립트가 커질 수 있어서다.
 * id 기준 upsert 로 스트리밍 중 갱신되는 항목(assistant 버블 등)을 같은 슬롯에 합친다.
 */
class TranscriptStore {
  private dir: string
  private cache = new Map<string, ChatItem[]>()

  constructor() {
    this.dir = join(app.getPath('userData'), 'transcripts')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  private fileFor(workspaceId: string): string {
    return join(this.dir, `${workspaceId}.json`)
  }

  load(workspaceId: string): ChatItem[] {
    if (this.cache.has(workspaceId)) return this.cache.get(workspaceId)!
    const file = this.fileFor(workspaceId)
    let items: ChatItem[] = []
    if (existsSync(file)) {
      try {
        items = JSON.parse(readFileSync(file, 'utf-8')) as ChatItem[]
      } catch {
        items = []
      }
    }
    this.cache.set(workspaceId, items)
    return items
  }

  private persist(workspaceId: string): void {
    const items = this.cache.get(workspaceId) ?? []
    writeFileAtomic(this.fileFor(workspaceId), JSON.stringify(items))
  }

  /** id 가 이미 있으면 교체, 없으면 추가. */
  upsert(workspaceId: string, item: ChatItem): void {
    const items = this.load(workspaceId)
    const idx = items.findIndex((i) => i.id === item.id)
    if (idx >= 0) items[idx] = item
    else items.push(item)
    this.persist(workspaceId)
  }

  remove(workspaceId: string): void {
    this.cache.delete(workspaceId)
    const file = this.fileFor(workspaceId)
    if (existsSync(file)) rmSync(file, { force: true })
  }
}

let instance: TranscriptStore | null = null

export function getTranscripts(): TranscriptStore {
  if (!instance) instance = new TranscriptStore()
  return instance
}
