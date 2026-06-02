import type { PermissionMode } from '@shared/types'

/** Shift+Tab 순환 순서 및 드롭다운 표시 순서. */
export const PERMISSION_ORDER: PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions'
]

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: 'Ask each time',
  acceptEdits: 'Auto-accept edits',
  plan: 'Plan mode',
  bypassPermissions: 'Accept all'
}

/** 권한 모드 한 줄 설명 (설정 화면용). */
export const PERMISSION_DESCRIPTIONS: Record<PermissionMode, string> = {
  default: 'Prompt before every tool use',
  acceptEdits: 'Auto-approve file edits, ask for the rest',
  plan: 'Read-only — plan without executing',
  bypassPermissions: 'Run every tool without asking'
}

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const i = PERMISSION_ORDER.indexOf(mode)
  return PERMISSION_ORDER[(i + 1) % PERMISSION_ORDER.length]
}
