/** Keep examples and quoted history from creating new response obligations. */
export function mentionProse(text: string): string {
  let fence: { marker: string; length: number } | undefined
  const prose = text.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (fence !== undefined) {
      if (marker?.[1]?.[0] === fence.marker
        && marker[1].length >= fence.length && marker[2]?.trim() === '') fence = undefined
      return line.replace(/[^\r]/gu, ' ')
    }
    if (marker?.[1] !== undefined) {
      fence = { marker: marker[1][0]!, length: marker[1].length }
      return line.replace(/[^\r]/gu, ' ')
    }
    if (/^ {0,3}>/u.test(line)) return line.replace(/[^\r]/gu, ' ')
    return line
  }).join('\n')
  return prose.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/gu,
    span => span.replace(/[^\r\n]/gu, ' '))
}

export function isEscapedMention(text: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
}
