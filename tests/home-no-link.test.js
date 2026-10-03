import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasOfficialLink, searchingMiss } from '../src/lib/home-searching.mjs'
import { homeShelf } from '../src/lib/home-auto.js'

const comic = (id, links) => ({ id, kind: 'comic', readLinks: links })
const LINK = [{ site: 'WEBTOON', url: 'https://example.com' }]

test('a cover counts as linked only when it shows a platform', () => {
  assert.equal(hasOfficialLink(comic(1, LINK)), true)
  assert.equal(hasOfficialLink(comic(2, [])), false)
  assert.equal(hasOfficialLink({ id: 3, kind: 'anime', watchLinks: LINK, readLinks: [] }), true)
  assert.equal(hasOfficialLink({ id: 4, kind: 'anime', watchLinks: [], readLinks: LINK }), false)
})

test('the planner never picks a no-link title for Hot this week', () => {
  assert.equal(searchingMiss({ g7: 99 }, comic(2, [])), 'no official link yet')
})

test('a homepage shelf drops no-link titles and fills from the next picks', () => {
  // Hot this week needs at least 4 covers to be drawn.
  const records = new Map([1, 2, 3, 4, 5, 6].map((id) => [id, comic(id, id === 2 ? [] : LINK)]))
  const plan = {
    sections: { searching: { enabled: true, items: [1, 2, 3, 4, 5].map((id) => ({ id })) } },
    next: { searching: [{ id: 6 }] },
  }
  const lookup = (id) => (records.has(id) ? { item: records.get(id) } : null)
  const shelf = homeShelf(plan, 'searching', { lookup, keep: hasOfficialLink })
  assert.ok(shelf)
  assert.deepEqual(shelf.items.map((i) => i.id), [1, 3, 4, 5, 6])
})
