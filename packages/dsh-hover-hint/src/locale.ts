export interface HoverHintLocaleCopy {
  readonly closeLabel: string
  readonly footer: string
}

const ENGLISH_COPY: HoverHintLocaleCopy = {
  closeLabel: 'Close hint',
  footer: 'Hover to preview; click to pin this window.',
}

const CHINESE_COPY: HoverHintLocaleCopy = {
  closeLabel: '关闭说明',
  footer: '悬停预览；点击可以固定此窗口。',
}

export function resolveHoverHintLocaleCopy(locale: string): HoverHintLocaleCopy {
  return locale.trim().toLowerCase().startsWith('zh') ? CHINESE_COPY : ENGLISH_COPY
}

export function currentHoverHintLocale(): string {
  if (typeof document !== 'undefined' && document.documentElement.lang.trim() !== '') {
    return document.documentElement.lang
  }
  return typeof navigator === 'undefined' ? 'en' : navigator.language
}
