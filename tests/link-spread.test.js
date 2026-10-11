// The cap on "You may also like" and the quiet slot for weakly linked titles
// (src/lib/link-spread.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pairChance,
  spreadDraw,
  spreadRank,
  capPicks,
  spotOrder,
  genreKeys,
  makerKeys,
  lessKnownPicks,
  SIMILAR_CAP,
  LESS_KNOWN_PER_HOST,
  LESS_KNOWN_HOSTS,
} from '../src/lib/link-spread.mjs'

const rows = (ids) => ids.map((id) => [{ id }, ['Action', 'Drama']])
const idsOf = (picked) => picked.map(([p]) => p.id)

test('pairChance is fixed for a pair and stays inside [0, 1)', () => {
  assert.equal(pairChance(12, 34), pairChance(12, 34))
  assert.notEqual(pairChance(12, 34), pairChance(34, 12))
  for (let i = 1; i < 500; i++) {
    const n = pairChance(i, i * 7919)
    assert.ok(n >= 0 && n < 1)
  }
})

test('pairChance spreads evenly enough to share places fairly', () => {
  let low = 0
  for (let i = 1; i <= 4000; i++) if (pairChance(i, 105398) < 0.25) low++
  assert.ok(low > 850 && low < 1150, String(low))
})

const pop = (id, popularity) => ({ id, popularity })

test('spreadRank puts readers picks first, then the most genres shared', () => {
  const list = [[pop(1, 9e5), ['A', 'B']], [pop(2, 10), ['A', 'B', 'C']], [pop(3, 10), ['A', 'B']]]
  const ranked = spreadRank(list, { itemId: 50, recSet: new Set([3]) })
  assert.deepEqual(idsOf(ranked), [3, 2, 1])
})

test('spreadRank gives different pages different orders, the same page the same order', () => {
  const list = Array.from({ length: 30 }, (_, i) => [pop(i + 1, 1000), ['A', 'B']])
  const first = idsOf(spreadRank(list, { itemId: 50 }))
  assert.deepEqual(idsOf(spreadRank(list, { itemId: 50 })), first)
  assert.notDeepEqual(idsOf(spreadRank(list, { itemId: 51 })), first)
  assert.equal(new Set(first).size, 30)
})

test('a well read title still comes up more often, but not every time', () => {
  const list = [[pop(1, 500000), ['A', 'B']], ...Array.from({ length: 29 }, (_, i) => [pop(i + 2, 2000), ['A', 'B']])]
  let big = 0
  let small = 0
  for (let item = 100; item < 2100; item++) {
    const top = idsOf(spreadRank(list, { itemId: item })).slice(0, 6)
    if (top.includes(1)) big++
    if (top.includes(2)) small++
  }
  assert.ok(big > small * 2, `${big} vs ${small}`)
  assert.ok(big < 2000)
  assert.ok(small > 0)
})

test('spreadDraw stays inside (0, 1]', () => {
  for (let i = 1; i < 300; i++) {
    const n = spreadDraw(i, pop(i * 31, i * 1000))
    assert.ok(n > 0 && n <= 1)
  }
  assert.ok(spreadDraw(1, { id: 2 }) > 0)
})

test('capPicks changes nothing while no candidate is at the cap', () => {
  const picked = capPicks(rows([1, 2, 3, 4, 5, 6, 7, 8]), { usedOf: () => 10 })
  assert.deepEqual(idsOf(picked), [1, 2, 3, 4, 5, 6])
})

test('capPicks hands a capped place to the next candidate', () => {
  const picked = capPicks(rows([1, 2, 3, 4, 5, 6, 7, 8]), { usedOf: (id) => (id === 1 ? SIMILAR_CAP : 5) })
  assert.deepEqual(idsOf(picked), [2, 3, 4, 5, 6, 7])
})

test('capPicks never drops a pick readers voted for', () => {
  const picked = capPicks(rows([1, 2, 3, 4, 5, 6, 7]), { usedOf: () => 1e9, always: (p) => p.id === 1 })
  assert.equal(idsOf(picked)[0], 1)
})

test('capPicks never shows fewer picks than there are candidates for', () => {
  assert.deepEqual(idsOf(capPicks(rows([1, 2, 3, 4]), { usedOf: () => 1e9 })), [1, 2, 3, 4])
  const six = capPicks(rows([1, 2, 3, 4, 5, 6, 7, 8, 9]), { usedOf: (id) => (id <= 7 ? 1e9 : 1) })
  assert.deepEqual(idsOf(six), [1, 2, 3, 4, 8, 9])
  assert.deepEqual(capPicks([], { usedOf: () => 0 }), [])
})

test('walking pages in ring order holds every title to the cap', () => {
  const pool = Array.from({ length: 40 }, (_, i) => [pop(i + 1, (40 - i) * 1000), ['A', 'B']])
  const pages = spotOrder(Array.from({ length: 300 }, (_, i) => ({ id: 1000 + i })))
  const used = new Map()
  for (const page of pages) {
    const picks = capPicks(spreadRank(pool, { itemId: page.id }), { usedOf: (id) => used.get(id) || 0, cap: 50 })
    assert.equal(picks.length, 6)
    for (const [p] of picks) used.set(p.id, (used.get(p.id) || 0) + 1)
  }
  assert.ok(Math.max(...used.values()) <= 50)
  assert.equal(used.size, 40)
})

test('spotOrder is fixed, and a new title does not reorder the others', () => {
  const titles = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }))
  const before = spotOrder(titles).map((t) => t.id)
  assert.deepEqual(spotOrder([...titles].reverse()).map((t) => t.id), before)
  const after = spotOrder([...titles, { id: 51 }]).map((t) => t.id).filter((id) => id !== 51)
  assert.deepEqual(after, before)
})

test('genreKeys files a title under every pair of its genres', () => {
  assert.deepEqual(genreKeys('manga', ['Drama', 'Action', 'Comedy']), ['manga|Action|Comedy', 'manga|Action|Drama', 'manga|Comedy|Drama'])
  assert.deepEqual(genreKeys('manga', ['Drama']), ['manga|Drama'])
  assert.deepEqual(genreKeys('manga', []), [])
  assert.deepEqual(genreKeys('manga', undefined), [])
})

const title = (id, kind, genres) => ({ id, kind, slug: `t${id}`, cover: 'c.jpg', genres })
const kindOf = (t) => t.kind

test('a weakly linked title is placed on pages that share its genres and kind', () => {
  const titles = [
    title(1, 'manga', ['Action', 'Drama']),
    title(2, 'manga', ['Action', 'Drama', 'Comedy']),
    title(3, 'manga', ['Action', 'Drama']),
    title(4, 'anime', ['Action', 'Drama']),
    title(5, 'manga', ['Romance', 'Sports']),
  ]
  const inbound = new Map([[1, 9], [2, 9], [3, 0], [4, 9], [5, 9]])
  const placed = lessKnownPicks(titles, { kindOf, inbound })
  const hosts = [...placed].filter(([, list]) => list.some(([t]) => t.id === 3)).map(([id]) => id)
  assert.deepEqual(hosts.sort(), [1, 2])
  for (const [, list] of placed) for (const [, shared] of list) assert.deepEqual(shared, ['Action', 'Drama'])
})

test('a title is never placed on its own page and never twice on one host', () => {
  const titles = [title(1, 'manga', ['Action', 'Drama']), title(2, 'manga', ['Action', 'Drama'])]
  const placed = lessKnownPicks(titles, { kindOf, inbound: new Map() })
  assert.deepEqual(placed.get(1).map(([t]) => t.id), [2])
  assert.deepEqual(placed.get(2).map(([t]) => t.id), [1])
})

test('well linked titles are not placed, and a title with one link gets one more', () => {
  const titles = [1, 2, 3, 4].map((id) => title(id, 'manga', ['Action', 'Drama']))
  const placed = lessKnownPicks(titles, { kindOf, inbound: new Map([[1, 5], [2, 5], [3, 5], [4, 1]]) })
  const all = [...placed.values()].flat().map(([t]) => t.id)
  assert.deepEqual(all, [4])
})

test('no host carries more than its share', () => {
  const titles = Array.from({ length: 60 }, (_, i) => title(i + 1, 'manga', ['Action', 'Drama']))
  const placed = lessKnownPicks(titles, { kindOf, inbound: new Map() })
  let total = 0
  for (const list of placed.values()) {
    assert.ok(list.length <= LESS_KNOWN_PER_HOST)
    total += list.length
  }
  assert.equal(total, 60 * LESS_KNOWN_HOSTS)
})

test('a title with one genre is matched on that genre, one with none is skipped', () => {
  const titles = [title(1, 'manga', ['Horror']), title(2, 'manga', ['Horror']), title(3, 'manga', []), { id: 4, kind: 'manga', slug: 't4', genres: ['Horror'] }]
  const placed = lessKnownPicks(titles, { kindOf, inbound: new Map() })
  const all = [...placed.values()].flat().map(([t]) => t.id).sort()
  assert.deepEqual(all, [1, 1, 2, 2])
})

test('a title with no genre is placed on pages by the same author or studio', () => {
  const by = (id, authors, studios) => ({ ...title(id, 'manga', []), authors, studios })
  const titles = [
    by(1, [{ name: 'Rumiko Takahashi' }], []),
    by(2, [{ name: 'Rumiko Takahashi' }], []),
    { ...title(3, 'manga', ['Action', 'Drama']), authors: [{ name: 'Rumiko Takahashi' }] },
    by(4, [{ name: 'Someone Else' }], []),
  ]
  const placed = lessKnownPicks(titles, { kindOf, inbound: new Map([[2, 9], [3, 9], [4, 9]]) })
  const hosts = [...placed].filter(([, list]) => list.some(([t]) => t.id === 1)).map(([id]) => id)
  assert.deepEqual(hosts.sort(), [2, 3])
  assert.deepEqual(placed.get(2)[0].slice(1), [[], 'Rumiko Takahashi'])
  assert.deepEqual(makerKeys('anime', { studios: ['MAPPA', 'MAPPA'], authors: [null] }), ['anime|by|MAPPA'])
  assert.deepEqual(makerKeys('anime', {}), [])
})

test('adding a newer title does not move the picks already placed', () => {
  const titles = Array.from({ length: 40 }, (_, i) => title(i + 1, 'manga', ['Action', 'Drama']))
  const inbound = new Map(titles.map((t) => [t.id, t.id % 5 === 0 ? 0 : 9]))
  const before = lessKnownPicks(titles, { kindOf, inbound })
  const after = lessKnownPicks([...titles, title(41, 'manga', ['Action', 'Drama'])], { kindOf, inbound: new Map([...inbound, [41, 9]]) })
  let same = 0
  let all = 0
  for (const [host, list] of before) {
    for (const [t] of list) {
      all++
      if ((after.get(host) || []).some(([other]) => other.id === t.id)) same++
    }
  }
  assert.ok(same >= all - 2, `${same} of ${all}`)
})
