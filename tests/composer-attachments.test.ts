import { describe, expect, it } from 'vitest'

import {
  fleetComposerFilePath,
  fleetComposerMessageText,
} from '../packages/ui/src/composer-attachments.js'

function localFile(name: string, path?: string): File {
  const file = new File(['content'], name, { type: 'text/plain' })
  if (path !== undefined) Object.defineProperty(file, 'path', { value: path })
  return file
}

describe('Fleet composer file paths', () => {
  it('sends original local paths without creating resource blocks', () => {
    const first = localFile('brief.txt', '/Users/example/Documents/brief.txt')
    const second = localFile('data.csv', '/Users/example/data set/data.csv')

    expect(fleetComposerMessageText('请检查这些文件', [first, second])).toBe([
      '请检查这些文件',
      '',
      '文件路径：',
      '- /Users/example/Documents/brief.txt',
      '- /Users/example/data set/data.csv',
    ].join('\n'))
    expect(fleetComposerMessageText('', [first])).toBe([
      '文件路径：',
      '- /Users/example/Documents/brief.txt',
    ].join('\n'))
  })

  it('fails directly when the desktop runtime does not expose a local path', () => {
    expect(() => fleetComposerFilePath(localFile('brief.txt')))
      .toThrow('无法读取 brief.txt 的本机路径')
  })
})
