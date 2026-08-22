export function resolveChineseLocale(documentLanguage: string, navigatorLanguage: string): boolean {
  return (documentLanguage.trim() || navigatorLanguage.trim()).toLowerCase().startsWith('zh')
}

export function isChineseLocale(): boolean {
  const documentLanguage = typeof document === 'undefined' ? '' : document.documentElement.lang
  const navigatorLanguage = typeof navigator === 'undefined' ? '' : navigator.language
  return resolveChineseLocale(documentLanguage, navigatorLanguage)
}
