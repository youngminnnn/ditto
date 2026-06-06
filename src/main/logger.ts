import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/**
 * main 프로세스 파일 로깅. userData/logs/main.log 에 타임스탬프 라인으로 append 하고
 * 콘솔에도 그대로 미러링한다(dev 터미널 가시성 유지).
 *
 * 배포된 앱은 콘솔이 보이지 않으므로, 사용자가 문제를 신고할 때 첨부할 수 있는
 * 영속 로그가 필요하다(CLI 미탐지·세션 오류 등 진단용). 외부 의존 없이 가볍게
 * 유지하려고 electron-log 대신 직접 구현했고, transcripts/store 와 같은
 * userData + appendFileSync 패턴을 따른다.
 */

// 1MB 초과 시 main.log.1 로 1세대만 회전한다(.1 은 덮어쓴다).
const MAX_BYTES = 1_000_000

let logFile: string | null = null

function file(): string {
  if (logFile) return logFile
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'main.log')
  return logFile
}

function rotateIfNeeded(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      renameSync(path, `${path}.1`)
    }
  } catch {
    // 회전 실패는 로깅 자체를 막지 않는다.
  }
}

type Level = 'info' | 'warn' | 'error'

function format(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function write(level: Level, args: unknown[]): void {
  const line = args.map(format).join(' ')

  // 콘솔 미러링(dev). 배포 빌드에서도 무해하다.
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  sink(line)

  try {
    const path = file()
    rotateIfNeeded(path)
    appendFileSync(path, `${new Date().toISOString()} [${level}] ${line}\n`, 'utf-8')
  } catch {
    // 파일 쓰기 실패(권한 등)는 무시 — 콘솔에는 이미 남겼다.
  }
}

export const log = {
  info: (...args: unknown[]): void => write('info', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args)
}

/** 로그 파일 절대 경로. 진단 안내·UI 노출이 필요할 때 사용한다. */
export function logFilePath(): string {
  return file()
}
