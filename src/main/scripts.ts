import { spawn, type ChildProcess } from 'node:child_process'
import { IPC } from '@shared/types'
import type { ScriptKind, ScriptStatus } from '@shared/types'

type Dispatch = (channel: string, payload: unknown) => void

interface Running {
  proc: ChildProcess
  exitCode: number | null
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
    const proc = spawn(shell, ['-lc', command], { cwd })
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

  stop(workspaceId: string, kind: ScriptKind): void {
    const entry = this.running.get(this.key(workspaceId, kind))
    if (entry && entry.proc.exitCode === null && !entry.proc.killed) {
      // 자식까지 정리하려면 프로세스 그룹 종료가 이상적이지만, v1 은 단순 종료로 둔다.
      entry.proc.kill('SIGTERM')
    }
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
    for (const { proc } of this.running.values()) {
      if (proc.exitCode === null && !proc.killed) proc.kill('SIGTERM')
    }
    this.running.clear()
  }
}
