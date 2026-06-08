import * as pty from 'node-pty'
import { IPC } from '@shared/types'

type Dispatch = (channel: string, payload: unknown) => void

/** 재부착 시 재생할 출력 버퍼 상한(바이트 근사). 초과분은 앞에서 잘라낸다. */
const BUFFER_LIMIT = 256 * 1024

interface Term {
  proc: pty.IPty
  /** 최근 출력 누적. workspace 전환 후 돌아왔을 때 화면을 복원하기 위해 보관한다. */
  buffer: string
}

/**
 * workspace 당 인터랙티브 PTY 1개를 관리한다(우하단 터미널).
 *
 * PTY 는 workspace 수명 동안 살아남아, 다른 workspace 를 보다가 돌아와도 실행 중이던
 * 명령과 셸 상태가 유지된다. 화면(xterm)은 재부착될 때 누적 버퍼를 reset 이벤트로 한 번에
 * 재생해 복원한다 — 출력은 단일 채널(evtTerminalData)로만 흘러 재생/실시간 순서가 보장된다.
 *
 * 로그인 셸로 띄워 nvm/asdf 등으로 구성된 사용자 PATH 를 그대로 쓴다.
 */
export class TerminalManager {
  private terms = new Map<string, Term>()

  constructor(private dispatch: Dispatch) {}

  /**
   * workspace 의 PTY 를 보장하고, 화면 복원을 위해 누적 버퍼를 reset 이벤트로 재생한다.
   * 이미 떠 있으면 새로 만들지 않고 버퍼만 재생한다(전환 후 복귀).
   */
  start(workspaceId: string, cwd: string, cols: number, rows: number): void {
    let term = this.terms.get(workspaceId)
    if (!term) {
      const shell = process.env.SHELL || '/bin/zsh'
      const proc = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols: Math.max(cols, 1),
        rows: Math.max(rows, 1),
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
      })
      term = { proc, buffer: '' }
      this.terms.set(workspaceId, term)

      proc.onData((data) => {
        const t = this.terms.get(workspaceId)
        if (t) {
          t.buffer += data
          if (t.buffer.length > BUFFER_LIMIT) t.buffer = t.buffer.slice(-BUFFER_LIMIT)
        }
        this.dispatch(IPC.evtTerminalData, { workspaceId, data })
      })
      proc.onExit(({ exitCode }) => {
        this.terms.delete(workspaceId)
        this.dispatch(IPC.evtTerminalExit, { workspaceId, code: exitCode })
      })
    } else {
      // 이미 떠 있던 PTY 면 요청 크기에 맞춰 다시 맞춘다.
      this.safeResize(term, cols, rows)
    }

    // 누적 버퍼를 화면 복원용으로 재생(reset). 실시간 출력과 같은 채널이라 순서가 보장된다.
    this.dispatch(IPC.evtTerminalData, { workspaceId, data: term.buffer, reset: true })
  }

  write(workspaceId: string, data: string): void {
    this.terms.get(workspaceId)?.proc.write(data)
  }

  resize(workspaceId: string, cols: number, rows: number): void {
    const term = this.terms.get(workspaceId)
    if (term) this.safeResize(term, cols, rows)
  }

  private safeResize(term: Term, cols: number, rows: number): void {
    try {
      term.proc.resize(Math.max(cols, 1), Math.max(rows, 1))
    } catch {
      // PTY 가 막 종료된 경우 등 — 무시.
    }
  }

  /** workspace 의 PTY 를 종료한다(아카이브/삭제 시). */
  disposeWorkspace(workspaceId: string): void {
    const term = this.terms.get(workspaceId)
    if (!term) return
    this.terms.delete(workspaceId)
    try {
      term.proc.kill()
    } catch {
      // 이미 종료됨.
    }
  }

  disposeAll(): void {
    for (const id of [...this.terms.keys()]) this.disposeWorkspace(id)
  }
}
