import assert from 'node:assert/strict'
import test from 'node:test'

import { beforeCutoff, cutoffTime, parseArxivFeed } from './arxiv-filter.mjs'

const feed = `<?xml version="1.0"?>
<feed>
  <entry>
    <id>http://arxiv.org/abs/2401.01234v2</id>
    <updated>2024-02-03T00:00:00Z</updated>
    <published>2024-01-02T00:00:00Z</published>
    <title>A &amp; B</title>
    <summary>  A useful\nabstract. </summary>
    <author><name>Ada Lovelace</name></author>
    <category term="math.NT" />
  </entry>
</feed>`

test('parses useful arXiv metadata', () => {
  assert.deepEqual(parseArxivFeed(feed), [{
    id: '2401.01234v2',
    title: 'A & B',
    authors: ['Ada Lovelace'],
    summary: 'A useful abstract.',
    published: '2024-01-02T00:00:00Z',
    updated: '2024-02-03T00:00:00Z',
    categories: ['math.NT'],
    abstractUrl: 'https://arxiv.org/abs/2401.01234v2',
    pdfUrl: 'https://export.arxiv.org/pdf/2401.01234v2',
  }])
})

test('treats a date-only cutoff as the end of that UTC day', () => {
  assert.equal(cutoffTime('2024-01-02'), Date.parse('2024-01-02T23:59:59.999Z'))
  assert.equal(beforeCutoff(parseArxivFeed(feed)[0], '2024-01-02'), true)
  assert.equal(beforeCutoff(parseArxivFeed(feed)[0], '2024-01-01'), false)
})

test('keeps the category prefix in legacy arXiv ids', () => {
  const legacy = feed.replaceAll('2401.01234v2', 'math/0102031v1')
  assert.equal(parseArxivFeed(legacy)[0].id, 'math/0102031v1')
  assert.equal(parseArxivFeed(legacy)[0].pdfUrl, 'https://export.arxiv.org/pdf/math/0102031v1')
})
