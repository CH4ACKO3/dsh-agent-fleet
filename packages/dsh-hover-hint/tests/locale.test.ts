import { describe, expect, it } from 'vitest'
import { resolveHoverHintLocaleCopy } from '../src/locale.js'

describe('hover hint locale copy', () => {
  it('uses Chinese copy for Chinese locales', () => {
    expect(resolveHoverHintLocaleCopy('zh-CN')).toEqual({
      closeLabel: '关闭说明',
      footer: '悬停预览；点击可以固定此窗口。',
    })
  })

  it('uses English copy for English and unknown locales', () => {
    expect(resolveHoverHintLocaleCopy('en-US')).toEqual({
      closeLabel: 'Close hint',
      footer: 'Hover to preview; click to pin this window.',
    })
    expect(resolveHoverHintLocaleCopy('de-DE')).toEqual(resolveHoverHintLocaleCopy('en-US'))
  })
})
