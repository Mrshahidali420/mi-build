// The "New this season" homepage shelf. See src/lib/season-shelf.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newSeasonShelf, seasonStartDay, SEASON_SHELF_DAYS, SEASON_SHELF_MIN, SEASON_SHELF_SIZE } from '../src/lib/season-shelf.mjs'

const show = (id, over = {}) => ({ id, kind: 'anime', title: `A${id}`, cover: `c${id}`, season: 'FALL', seasonYear: 2026, popularity: id, ...over })
const fall = Array.from({ length: 25 }, (_, i) => show(i + 1))

test('the season starts on the first of its first month, UTC', () => {
  assert.equal(seasonStartDay(2026, 'FALL').toISOString().slice(0, 10), '2026-10-01')
  assert.equal(seasonStartDay(2027, 'WINTER').toISOString().slice(0, 10), '2027-01-01')
})

test('it appears on day one and leaves after six weeks', () => {
  assert.equal(newSeasonShelf(fall, { now: new Date('2026-09-30T23:00:00Z') }), null, 'summer still')
  const shelf = newSeasonShelf(fall, { now: new Date('2026-10-01T02:00:00Z') })
  assert.equal(shelf.key, 'season')
  assert.equal(shelf.title, 'New this season: Fall 2026')
  assert.equal(shelf.href, '/anime/season/2026/fall')
  assert.equal(shelf.items.length, SEASON_SHELF_SIZE)
  assert.equal(shelf.items[0].id, 25, 'most followed first')
  const last = new Date(Date.UTC(2026, 9, 1) + (SEASON_SHELF_DAYS - 1) * 86400000)
  assert.ok(newSeasonShelf(fall, { now: last }))
  assert.equal(newSeasonShelf(fall, { now: new Date(last.getTime() + 86400000) }), null)
})

test('covers already on the page are left out, and a shelf left too short hides', () => {
  const now = new Date('2026-10-05T00:00:00Z')
  const some = new Set([25, 24])
  const shelf = newSeasonShelf(fall, { now, onPage: some })
  assert.ok(shelf.items.every((a) => !some.has(a.id)))
  // 20 of 25 already elsewhere on the page: 5 left, under the floor of 6.
  const most = new Set(fall.slice(0, 20).map((a) => a.id))
  assert.equal(newSeasonShelf(fall, { now, onPage: most }), null)
})

test('a short season is not drawn', () => {
  const now = new Date('2026-10-05T00:00:00Z')
  const few = fall.slice(0, SEASON_SHELF_MIN - 1)
  assert.equal(newSeasonShelf(few, { now }), null)
  const keep = (a) => a.id % 2 === 0
  assert.ok(newSeasonShelf(fall, { now, keep }).items.every((a) => a.id % 2 === 0))
  const other = fall.map((a) => ({ ...a, seasonYear: 2025 }))
  assert.equal(newSeasonShelf(other, { now }), null)
})
