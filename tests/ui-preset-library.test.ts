import { describe, expect, it } from 'vitest'

import {
  type FieldPresetCollection,
  mergeFieldPresetImport,
  parseFieldPresetImport,
} from '../packages/ui/src/field-presets.js'
import { fleetLocaleDictionaries, resolveChineseLocale } from '../packages/ui/src/locale.js'

const current: FieldPresetCollection = {
  positioning: [],
  rules: [{
    id: 'custom-local',
    name: ['持久状态唯一来源', '持久状态唯一来源'],
    detail: ['旧内容', '旧内容'],
  }],
  collaboration: [],
  content: [],
  resources: [],
}

describe('Fleet UI locale', () => {
  it('prefers the host document locale over the browser locale', () => {
    expect(resolveChineseLocale('zh-CN', 'en-US')).toBe(true)
    expect(resolveChineseLocale('en-US', 'zh-CN')).toBe(false)
    expect(resolveChineseLocale('', 'zh-CN')).toBe(true)
  })

  it('keeps the Agent Fleet dictionaries bilingual and key-compatible', () => {
    expect(Object.keys(fleetLocaleDictionaries.en)).toEqual(Object.keys(fleetLocaleDictionaries.zh))
  })
})

describe('field preset library import', () => {
  it('preserves bilingual field preset content', () => {
    expect(parseFieldPresetImport({
      fields: {
        rules: [{
          id: 'durable-source-of-truth',
          name: ['持久状态唯一来源', 'Durable source of truth'],
          detail: ['新内容', 'New detail'],
        }],
      },
    })).toEqual({
      rules: [{
        id: 'durable-source-of-truth',
        name: ['持久状态唯一来源', 'Durable source of truth'],
        detail: ['新内容', 'New detail'],
      }],
    })
  })

  it('replaces a same-name local entry without breaking its selected id', () => {
    const imported = parseFieldPresetImport({
      fields: {
        rules: [{
          id: 'durable-source-of-truth',
          name: ['持久状态唯一来源', 'Durable source of truth'],
          detail: ['新内容', 'New detail'],
        }],
      },
    })

    expect(mergeFieldPresetImport(current, imported!).rules).toEqual([{
      id: 'custom-local',
      name: ['持久状态唯一来源', 'Durable source of truth'],
      detail: ['新内容', 'New detail'],
    }])
  })

  it('rejects single-language field presets', () => {
    expect(() => parseFieldPresetImport({
      fields: {
        content: [{ id: 'broken', name: ['只有中文'], detail: ['正文', 'Detail'] }],
      },
    })).toThrow('invalid content field preset')
  })
})
