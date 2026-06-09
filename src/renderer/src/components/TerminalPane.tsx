import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { TerminalSquare, RotateCw } from 'lucide-react'

/**
 * 우하단 인터랙티브 터미널. workspace 의 PTY(메인 프로세스)에 붙는다.
 *
 * PTY 는 메인에서 workspace 수명 동안 유지되므로, 이 컴포넌트는 화면(xterm)만 담당한다.
 * 부착 시 메인이 누적 버퍼를 reset 이벤트로 재생해 직전 상태를 복원한다. 입력은 PTY 로
 * 그대로 보내고, 크기는 컨테이너 변화에 맞춰 fit + resize 한다. 언마운트해도 PTY 는 끄지 않는다.
 */
export default function TerminalPane({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [exited, setExited] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontSize: 12,
      fontFamily: "'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace",
      lineHeight: 1.2,
      cursorBlink: true,
      theme: { background: '#0d0e11', foreground: '#d4d4d8', cursor: '#d4d4d8' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const safeFit = (): { cols: number; rows: number } => {
      try {
        fit.fit()
      } catch {
        // 컨테이너 크기가 0 인 순간 등 — 무시.
      }
      return { cols: term.cols, rows: term.rows }
    }

    // 첫 레이아웃 이후 크기를 잡고 PTY 부착 시작.
    const raf = requestAnimationFrame(() => {
      const { cols, rows } = safeFit()
      void window.api.terminal.start(workspaceId, cols, rows)
    })

    // 사용자 입력 → PTY.
    const inputSub = term.onData((data) => {
      void window.api.terminal.input(workspaceId, data)
    })

    // PTY 출력 → 화면. reset 이면 화면을 비우고 누적 버퍼로 다시 채운다(부착 복원).
    const offData = window.api.terminal.onData((e) => {
      if (e.workspaceId !== workspaceId) return
      if (e.reset) {
        term.reset()
        setExited(false)
      }
      if (e.data) term.write(e.data)
    })

    const offExit = window.api.terminal.onExit((e) => {
      if (e.workspaceId !== workspaceId) return
      setExited(true)
      term.write(`\r\n\x1b[90m[process exited (${e.code ?? '?'})]\x1b[0m\r\n`)
    })

    // 컨테이너 크기 변화 → fit + PTY resize.
    const ro = new ResizeObserver(() => {
      const { cols, rows } = safeFit()
      void window.api.terminal.resize(workspaceId, cols, rows)
    })
    ro.observe(host)

    return () => {
      cancelAnimationFrame(raf)
      inputSub.dispose()
      offData()
      offExit()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      // PTY 는 의도적으로 유지한다(다음 부착 시 복원).
    }
  }, [workspaceId])

  const restart = (): void => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    term.reset()
    setExited(false)
    try {
      fit.fit()
    } catch {
      // 무시.
    }
    void window.api.terminal.start(workspaceId, term.cols, term.rows)
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-[var(--bg-2)]">
      <div className="h-7 shrink-0 flex items-center gap-1.5 px-3 border-b border-[var(--surface-2)] text-[11px] text-neutral-500">
        <TerminalSquare size={12} />
        <span>Terminal</span>
        <div className="flex-1" />
        {exited && (
          <button
            onClick={restart}
            className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
            title="Restart shell"
          >
            <RotateCw size={11} /> Restart
          </button>
        )}
      </div>
      <div ref={hostRef} className="flex-1 min-h-0 px-2 py-1 overflow-hidden" />
    </div>
  )
}
