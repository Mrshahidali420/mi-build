// The homepage's own shelf numbers, home_seen and home_click: what the page
// may send, what the Worker keeps, how the rows are batched, and the promise
// on /privacy that has to ship with them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanRow, COLUMNS } from '../src/lib/beacon-rows.js'
import { toOwnRow, seenBatch } from '../src/lib/own-count.js'
import { homeSeenDetail, homeSection, shelfNumbers, HOME_SECTIONS } from '../src/lib/home-sections.js'
import { DID } from '../src/lib/action-sql.js'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const clean = (row) => {
  const values = cleanRow(row, 'US', NOW)
  return values && Object.fromEntries(COLUMNS.map((c, i) => [c, values[i]]))
}

test('shelf keys: five known words, one fixed order', () => {
  assert.deepEqual(HOME_SECTIONS, ['rising', 'saving', 'new', 'month', 'chars'])
  assert.equal(homeSeenDetail(['month', 'rising', 'month', 'nope']), 'rising-month')
  assert.equal(homeSeenDetail('saving-rising'), 'rising-saving')
  assert.equal(homeSeenDetail(''), '')
  assert.equal(homeSection('saving'), 'saving')
  assert.equal(homeSection('Saving'), '')
})

test('the page sends a seen row with its shelves and a click with id, shelf and slot', () => {
  assert.deepEqual(toOwnRow('home_seen', { sections: ['saving', 'rising'], shown: 2, title: 'x', title_id: 5 }), {
    name: 'home_seen', kind: 'act', item: '', detail: 'rising-saving', pos: 2, label: '',
  })
  assert.deepEqual(toOwnRow('home_click', { title_id: 151807, section: 'rising', slot: 3, title: 'Solo Leveling' }), {
    name: 'home_click', kind: 'act', item: '151807', detail: 'rising', pos: 3, label: 'Solo Leveling',
  })
  assert.equal(toOwnRow('home_click', { title_id: 5, section: 'sidebar', slot: 1 }), null, 'unknown shelf')
  assert.equal(toOwnRow('home_click', { section: 'rising', slot: 1 }), null, 'no title id')
  assert.equal(toOwnRow('home_seen', { sections: ['nope'] }), null, 'no known shelf')
})

test('seen rows are batched: one row per page view, never one per shelf', () => {
  const sent = []
  const batch = seenBatch((row) => sent.push(row))
  batch.saw('rising')
  batch.saw('saving')
  batch.saw('rising')
  batch.saw('made-up')
  assert.equal(sent.length, 0, 'nothing leaves while the page is open')
  batch.flush()
  batch.flush()
  batch.saw('month')
  batch.flush()
  assert.equal(sent.length, 1, 'one row for the whole view')
  assert.equal(sent[0].detail, 'rising-saving')
  assert.equal(sent[0].pos, 2)
  const quiet = []
  seenBatch((row) => quiet.push(row)).flush()
  assert.equal(quiet.length, 0, 'no shelf seen, no row')
})

test('the Worker keeps only known shelves and whole ids', () => {
  const seen = clean({ kind: 'act', name: 'home_seen', item: '123', detail: 'saving-rising', pos: 2, label: 'Solo Leveling' })
  assert.equal(seen.item, '', 'a seen row never carries a title')
  assert.equal(seen.label, '')
  assert.equal(seen.detail, 'rising-saving')
  assert.equal(cleanRow({ kind: 'act', name: 'home_seen', detail: 'rising-my list' }, 'US', NOW), null)
  assert.equal(cleanRow({ kind: 'act', name: 'home_seen', detail: 'rising-secret' }, 'US', NOW), null, 'any unknown shelf drops the row')
  const click = clean({ kind: 'act', name: 'home_click', item: '151807', detail: 'new', pos: 4, label: 'Title' })
  assert.deepEqual([click.item, click.detail, click.pos, click.label], ['151807', 'new', 4, 'Title'])
  assert.equal(cleanRow({ kind: 'act', name: 'home_click', item: 'abc', detail: 'new' }, 'US', NOW), null)
  assert.equal(cleanRow({ kind: 'act', name: 'home_click', item: '5', detail: 'footer' }, 'US', NOW), null)
})

test('a seen row does not count as the reader doing something', () => {
  // A homepage visit that only scrolled past the shelves is still a quick exit.
  assert.match(DID, /name <> 'home_seen'/)
})

test('the admin tab adds seen rows up for every shelf they name', () => {
  const out = shelfNumbers([
    { name: 'home_seen', detail: 'rising-saving', n: 10 },
    { name: 'home_seen', detail: 'saving', n: 5 },
    { name: 'home_click', item: '7', detail: 'saving', n: 2 },
    { name: 'home_click', item: '7', detail: 'saving', n: 1 },
    { name: 'home_click', item: '8', detail: 'bogus', n: 9 },
  ])
  assert.deepEqual(out.seen, { rising: 10, saving: 15 })
  assert.equal(out.clicks.get('saving:7'), 3)
  assert.deepEqual(out.shelfClicks, { saving: 3 })
})

test('/privacy says the homepage shelves are counted, counts only', () => {
  const page = readFileSync(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.match(page, /which shelves were on screen and which title you opened from a shelf, as counts only/)
})
