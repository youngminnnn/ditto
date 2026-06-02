/**
 * main 의 sanitizeBranch([[git]]) 와 같은 규칙으로 브랜치 슬러그를 미리보기한다.
 * 두 곳이 어긋나면 표시와 실제 생성 브랜치가 달라지므로 규칙을 동일하게 유지한다.
 */
/**
 * 세션 헤더에 보여줄 모델명. init 메시지의 실제 모델(lastModel)을 우선하고,
 * 아직 세션을 시작하지 않았으면 설정의 별칭(opus/sonnet/…) 또는 'default' 를 보여준다.
 */
export function displayModelName(lastModel: string | null, settingModel: string | null): string {
  if (lastModel) return lastModel
  if (settingModel) return settingModel
  return 'default'
}

export function sanitizePreview(name: string): string {
  const slug = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]/g, '')
    .replace(/^[-/]+/, '')
    .replace(/\/{2,}/g, '/')
  return slug || 'workspace'
}
