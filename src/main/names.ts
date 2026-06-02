// workspace 이름 자동 생성용 형용사·명사 목록. Docker/Conductor 류의 친근한 슬러그.
const ADJECTIVES = [
  'swift', 'calm', 'bold', 'bright', 'keen', 'brave', 'clever', 'lucky',
  'nimble', 'quiet', 'sunny', 'witty', 'eager', 'gentle', 'jolly', 'amber',
  'cosmic', 'mellow', 'rapid', 'vivid'
]
const NOUNS = [
  'otter', 'falcon', 'maple', 'river', 'comet', 'willow', 'pixel', 'ember',
  'harbor', 'meadow', 'cobalt', 'quartz', 'sparrow', 'cedar', 'lumen', 'delta',
  'badger', 'lagoon', 'cypress', 'nimbus'
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * 기존 이름과 겹치지 않는 friendly 한 workspace 이름을 만든다.
 * 형용사-명사 조합을 시도하고, 충돌이 잦으면 `workspace-N` 으로 폴백한다.
 */
export function generateWorkspaceName(existing: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const candidate = `${pick(ADJECTIVES)}-${pick(NOUNS)}`
    if (!existing.has(candidate)) return candidate
  }
  let n = 1
  while (existing.has(`workspace-${n}`)) n++
  return `workspace-${n}`
}
