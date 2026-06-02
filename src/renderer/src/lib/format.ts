/**
 * main 의 sanitizeBranch([[git]]) 와 같은 규칙으로 브랜치 슬러그를 미리보기한다.
 * 두 곳이 어긋나면 표시와 실제 생성 브랜치가 달라지므로 규칙을 동일하게 유지한다.
 */
export function sanitizePreview(name: string): string {
  const slug = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]/g, '')
    .replace(/^[-/]+/, '')
    .replace(/\/{2,}/g, '/')
  return slug || 'workspace'
}
