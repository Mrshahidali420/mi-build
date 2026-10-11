// The A–Z index: how names are filed, cut into pages and files, and read back
// (src/lib/browse.mjs, src/lib/browse-read.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BROWSE_PER_PAGE,
  BROWSE_CHUNK_PAGES,
  BROWSE_LETTERS,
  BROWSE_OTHER,
  sortKeyOf,
  letterOf,
  letterLabel,
  browseGroups,
  pageCountOf,
  chunkOf,
  chunkName,
  chunksOf,
  pageRows,
  browsePath,
  pageParam,
} from '../src/lib/browse.mjs'
import { loadBrowsePage } from '../src/lib/browse-read.js'
import { ShardUnavailable } from '../src/lib/runtime.js'

test('there are 27 letters: 0-9 and a to z', () => {
  assert.equal(BROWSE_LETTERS.length, 27)
  assert.equal(BROWSE_LETTERS[0], BROWSE_OTHER)
  assert.equal(BROWSE_LETTERS[26], 'z')
})

test('a name is filed under its first letter, whatever the case or accent', () => {
  assert.equal(letterOf('Solo Leveling'), 's')
  assert.equal(letterOf('Éclair'), 'e')
  assert.equal(letterOf('"Oshi no Ko"'), 'o')
  assert.equal(letterOf('...and then'), 'a')
})

test('digits, other scripts and empty names go under 0-9', () => {
  assert.equal(letterOf('86 EIGHTY-SIX'), BROWSE_OTHER)
  assert.equal(letterOf('進撃の巨人'), BROWSE_OTHER)
  assert.equal(letterOf(''), BROWSE_OTHER)
  assert.equal(letterOf(undefined), BROWSE_OTHER)
  assert.equal(letterLabel(BROWSE_OTHER), '0–9')
  assert.equal(letterLabel('q'), 'Q')
})

test('sortKeyOf drops accents, case and leading punctuation', () => {
  assert.equal(sortKeyOf('  [Oshi] no Ko'), 'oshi] no ko')
  assert.equal(sortKeyOf('Élan'), 'elan')
})

test('browseGroups sorts each letter by name and keeps namesakes in a fixed order', () => {
  const groups = browseGroups([
    { name: 'Bleach', path: '/manga/bleach' },
    { name: 'berserk', path: '/manga/berserk' },
    { name: 'Akira', path: '/manga/akira' },
    { name: 'Akira', path: '/anime/akira' },
    { name: '', path: '/manga/x' },
    { name: 'No path' },
    null,
  ])
  assert.deepEqual([...groups.keys()].sort(), ['a', 'b'])
  assert.deepEqual(groups.get('a'), [['Akira', '/anime/akira'], ['Akira', '/manga/akira']])
  assert.deepEqual(groups.get('b').map(([name]) => name), ['berserk', 'Bleach'])
  assert.equal(browseGroups(undefined).size, 0)
})

test('pages and files are counted from the same numbers', () => {
  assert.equal(pageCountOf(0), 1)
  assert.equal(pageCountOf(BROWSE_PER_PAGE), 1)
  assert.equal(pageCountOf(BROWSE_PER_PAGE + 1), 2)
  assert.equal(chunkOf(1), 0)
  assert.equal(chunkOf(BROWSE_CHUNK_PAGES), 0)
  assert.equal(chunkOf(BROWSE_CHUNK_PAGES + 1), 1)
  assert.equal(chunkName('t', 'a', 3), 't-a-3')
})

test('every row comes back on exactly one page', () => {
  const total = BROWSE_PER_PAGE * BROWSE_CHUNK_PAGES * 2 + 37
  const rows = Array.from({ length: total }, (_, i) => [`n${i}`, `/manga/n${i}`])
  const chunks = chunksOf(rows)
  assert.equal(chunks.length, 3)
  const seen = []
  for (let page = 1; page <= pageCountOf(total); page++) seen.push(...pageRows(chunks[chunkOf(page)], page))
  assert.deepEqual(seen, rows)
  assert.equal(pageRows(chunks[2], pageCountOf(total)).length, 37)
  assert.deepEqual(pageRows(undefined, 1), [])
})

test('page 1 is the letter address, later pages carry their number', () => {
  assert.equal(browsePath('titles', 'a'), '/a-z/titles/a')
  assert.equal(browsePath('titles', 'a', 1), '/a-z/titles/a')
  assert.equal(browsePath('characters', '0-9', 12), '/a-z/characters/0-9/12')
})

test('pageParam takes whole numbers from 2 up and nothing else', () => {
  assert.equal(pageParam('2'), 2)
  assert.equal(pageParam('140'), 140)
  for (const bad of ['1', '0', '-3', '02', '2.5', 'abc', '', undefined, '1234567']) assert.equal(pageParam(bad), null)
})

// A stand-in for the ASSETS binding: serves the given files, counts the reads.
const assets = (files) => {
  const env = {
    reads: 0,
    ASSETS: {
      fetch: async (request) => {
        env.reads++
        const name = new URL(request.url).pathname.replace('/d/b/', '').replace('.json', '')
        if (!(name in files)) return new Response('no', { status: 404 })
        return new Response(JSON.stringify(files[name]), { status: 200 })
      },
    },
  }
  return env
}

test('loadBrowsePage reads the right rows and the counts', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => [`Q${String(i).padStart(3, '0')}`, `/manga/q${i}`])
  const env = assets({ index: { t: { q: 250, z: 0 }, c: {} }, 't-q-0': rows })
  const page = await loadBrowsePage(env, 'titles', 'q', 3)
  assert.equal(page.count, 250)
  assert.equal(page.pageCount, 3)
  assert.equal(page.rows.length, 50)
  assert.deepEqual(page.rows[0], rows[200])
  assert.deepEqual(page.letters, ['q'])
})

test('loadBrowsePage answers null for a page that does not exist', async () => {
  const env = assets({ index: { t: { q: 250 }, c: {} }, 't-q-0': [] })
  assert.equal(await loadBrowsePage(env, 'titles', 'q', 4), null)
  assert.equal(await loadBrowsePage(env, 'titles', 'x', 1), null)
  assert.equal(await loadBrowsePage(env, 'characters', 'q', 1), null)
  assert.equal(await loadBrowsePage(env, 'people', 'q', 1), null)
  assert.equal(await loadBrowsePage(env, 'titles', 'Q', 1), null)
  assert.equal(await loadBrowsePage(env, 'titles', 'q', 0), null)
  assert.equal(await loadBrowsePage(env, 'titles', 'q', 1.5), null)
})

test('loadBrowsePage throws when a file cannot be read, so the page answers 503', async () => {
  const env = assets({ index: { t: { w: 5 }, c: {} } })
  await assert.rejects(() => loadBrowsePage(env, 'titles', 'w', 1), ShardUnavailable)
})
