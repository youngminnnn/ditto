import { spawn, type ChildProcess } from 'node:child_process'
import { IPC } from '@shared/types'
import type { ScriptKind, ScriptStatus } from '@shared/types'

type Dispatch = (channel: string, payload: unknown) => void

interface Running {
  proc: ChildProcess
  exitCode: number | null
}

/**
 * 프로세스 그룹 전체를 종료한다. detached 로 spawn 한 자식은 자신이 그룹 리더이므로,
 * 음수 pid 로 시그널을 보내면 자식이 띄운 손자(dev 서버의 node/vite 등)까지 함께 정리된다.
 * 그룹 종료가 불가능하면 자식 프로세스 하나만이라도 종료한다.
 */
function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (proc.pid === undefined || proc.exitCode !== null || proc.killed) return
  try {
    process.kill(-proc.pid, signal)
  } catch {
    try {
      proc.kill(signal)
    } catch {
      // 이미 종료됨.
    }
  }
}

/**
 * workspace 별 setup/dev 스크립트를 실행하고 출력을 renderer 로 스트리밍한다.
 * (workspaceId, kind) 당 프로세스 1개. dev 서버처럼 장수명 프로세스를 띄울 수 있다.
 *
 * 로그인 셸(`$SHELL -lc`)로 실행해 nvm/asdf 등으로 구성된 사용자 PATH 를 그대로 쓴다
 * — 패키징된 앱은 환경이 빈약할 수 있어 명시적으로 로그인 셸을 거친다.
 */
export class ScriptRunner {
  private running = new Map<string, Running>()

  constructor(private dispatch: Dispatch) {}

  private key(workspaceId: string, kind: ScriptKind): string {
    return `${workspaceId}:${kind}`
  }

  run(workspaceId: string, kind: ScriptKind, command: string, cwd: string): void {
    if (!command.trim()) return
    this.stop(workspaceId, kind)

    const shell = process.env.SHELL || '/bin/zsh'
    // detached 로 새 프로세스 그룹을 만든다 — 중지 시 자식이 띄운 손자까지 그룹 단위로 정리한다.
    const proc = spawn(shell, ['-lc', command], { cwd, detached: true })
    this.running.set(this.key(workspaceId, kind), { proc, exitCode: null })

    proc.stdout?.on('data', (data: Buffer) => {
      this.dispatch(IPC.evtScriptOutput, {
        workspaceId,
        kind,
        stream: 'stdout',
        chunk: data.toString()
      })
    })
    proc.stderr?.on('data', (data: Buffer) => {
      this.dispatch(IPC.evtScriptOutput, {
        workspaceId,
        kind,
        stream: 'stderr',
        chunk: data.toString()
      })
    })
    proc.on('error', (err) => {
      this.dispatch(IPC.evtScriptOutput, {
        workspaceId,
        kind,
        stream: 'stderr',
        chunk: `\n[ditto] failed to start: ${err.message}\n`
      })
    })
    proc.on('close', (code) => {
      const entry = this.running.get(this.key(workspaceId, kind))
      if (entry) entry.exitCode = code
      this.dispatch(IPC.evtScriptExit, { workspaceId, kind, code })
    })
  }

  /**
   * 일회성 명령을 실행하고 종료까지 기다린다(아카이브 스크립트 등).
   * timeout 초과 시 종료를 강제하고 resolve 한다 — 아카이브가 무한정 멈추지 않게.
   */
  runOnce(command: string, cwd: string, timeoutMs = 120_000): Promise<void> {
    if (!command.trim()) return Promise.resolve()
    return new Promise((resolve) => {
      const shell = process.env.SHELL || '/bin/zsh'
      const proc = spawn(shell, ['-lc', command], { cwd, detached: true })
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        resolve()
      }
      const timer = setTimeout(() => {
        killProcessGroup(proc)
        finish()
      }, timeoutMs)
      proc.on('error', () => {
        clearTimeout(timer)
        finish()
      })
      proc.on('close', () => {
        clearTimeout(timer)
        finish()
      })
    })
  }

  stop(workspaceId: string, kind: ScriptKind): void {
    const entry = this.running.get(this.key(workspaceId, kind))
    if (entry) killProcessGroup(entry.proc)
    this.running.delete(this.key(workspaceId, kind))
  }

  getStatus(workspaceId: string): ScriptStatus[] {
    const kinds: ScriptKind[] = ['setup', 'dev']
    return kinds.map((kind) => {
      const entry = this.running.get(this.key(workspaceId, kind))
      if (!entry) return { kind, state: 'idle', exitCode: null }
      if (entry.proc.exitCode === null && !entry.proc.killed) {
        return { kind, state: 'running', exitCode: null }
      }
      return { kind, state: 'exited', exitCode: entry.exitCode }
    })
  }

  disposeWorkspace(workspaceId: string): void {
    this.stop(workspaceId, 'setup')
    this.stop(workspaceId, 'dev')
  }

  disposeAll(): void {
    for (const { proc } of this.running.values()) killProcessGroup(proc)
    this.running.clear()
  }
}
