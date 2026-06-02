/**
 * 세션 응답 완료 알림음. 에셋 없이 Web Audio API 로 짧은 2음 차임을 생성한다.
 */
let ctx: AudioContext | null = null

export function playNotification(): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    // 두 음(상행)으로 부드러운 완료 차임.
    playTone(ctx, 660, now, 0.12)
    playTone(ctx, 880, now + 0.12, 0.16)
  } catch {
    // 오디오 불가 환경은 조용히 무시.
  }
}

function playTone(ctx: AudioContext, freq: number, start: number, dur: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}
