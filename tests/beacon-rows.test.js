import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanRow, COLUMNS, INSERT_SQL } from '../src/lib/beacon-rows.js'

const NOW = Date.parse('2026-09-24T12:00:00Z')
const asObject = (values) => values && Object.fromEntries(COLUMNS.map((c, i) => [c, values[i]]))
const clean = (row) => asObject(cleanRow(row, 'US', NOW))

test('the insert names every column once, in order', () => {
  assert.equal((INSERT_SQL.match(/\?/g) || []).length, COLUMNS.length)
  assert.equal(new Set(COLUMNS).size, COLUMNS.length)
})

test('a page view keeps its fields, cut to length', () => {
  const row = clean({ name: 'page_view_scroll', kind: 'view', path: '/manga/x', label: 'x'.repeat(500), age: 5000 })
  assert.equal(row.kind, 'view')
  assert.equal(row.label.length, 120)
  assert.equal(row.ts, NOW - 5000)
  assert.equal(row.day, '2026-09-24')
  assert.equal(row.country, 'US')
})

test('an unknown kind becomes other, a missing kind becomes view', () => {
  assert.equal(clean({ kind: 'hack' }).kind, 'other')
  assert.equal(clean({}).kind, 'view')
})

test('numbers are clamped', () => {
  const row = clean({ kind: 'leave', dwell: 99999999, step: -3, age: 1e12 })
  assert.equal(row.dwell, 1800000)
  assert.equal(row.step, 0)
  assert.equal(row.ts, NOW - 86400000)
})

test('a read or watch click keeps only the Linkvertise mark', () => {
  assert.equal(clean({ kind: 'read', detail: 'lv' }).detail, 'lv')
  assert.equal(clean({ kind: 'watch', detail: 'lv' }).detail, 'lv')
  assert.equal(clean({ kind: 'read', detail: 'anything' }).detail, '')
  assert.equal(clean({ kind: 'view', detail: 'lv' }).detail, '')
})

test('an act row with an unknown name is dropped', () => {
  assert.equal(cleanRow({ kind: 'act', name: 'list_export', item: '5' }, 'US', NOW), null)
})

test('a list action about a title keeps id, status and title name', () => {
  const row = clean({ kind: 'act', name: 'list_add', item: '101517', detail: 'PLANNING', label: 'Solo Leveling' })
  assert.equal(row.item, '101517')
  assert.equal(row.detail, 'PLANNING')
  assert.equal(row.label, 'Solo Leveling')
})

test('a title action without a title id is dropped', () => {
  assert.equal(cleanRow({ kind: 'act', name: 'list_add', item: 'my secret list' }, 'US', NOW), null)
})

test('count-only actions can never carry a name, even from a changed page', () => {
  const row = clean({ kind: 'act', name: 'list_create', item: 'Guilty pleasures', label: 'Guilty pleasures', pos: 3 })
  assert.equal(row.item, '')
  assert.equal(row.label, '')
  assert.equal(row.pos, 3)
  const imp = clean({ kind: 'act', name: 'anilist_import', item: 'someuser', label: 'someuser', detail: 'ok' })
  assert.equal(imp.item, '')
  assert.equal(imp.label, '')
  assert.equal(imp.detail, 'ok')
})

test('a detail that is not one short word is emptied', () => {
  assert.equal(clean({ kind: 'act', name: 'list_status', item: '5', detail: 'DROPPED; drop table' }).detail, '')
})

test('act and search rows never keep link fields', () => {
  const row = clean({ kind: 'act', name: 'feed_view', target: 'https://x', platform: 'X', shop_kind: 'books', pos: 12 })
  assert.equal(row.target, '')
  assert.equal(row.platform, '')
  assert.equal(row.shop_kind, '')
})

test('search_none words are cleaned again on the server', () => {
  assert.equal(clean({ kind: 'search', name: 'search_none', item: '  Solo  LEVELING  ' }).item, 'solo leveling')
  assert.equal(cleanRow({ kind: 'search', name: 'search_none', item: 'me@mail.com' }, 'US', NOW), null)
  assert.equal(cleanRow({ kind: 'search', name: 'search_none', item: '0300 123 4567' }, 'US', NOW), null)
})

test('search_pick keeps only one of our own addresses', () => {
  const row = clean({ kind: 'search', name: 'search_pick', item: '/manhwa/solo-leveling', detail: 'page', pos: 2, label: 'Solo Leveling' })
  assert.equal(row.item, '/manhwa/solo-leveling')
  assert.equal(row.detail, 'page')
  assert.equal(row.pos, 2)
  assert.equal(cleanRow({ kind: 'search', name: 'search_pick', item: 'https://evil.example/x' }, 'US', NOW), null)
  assert.equal(clean({ kind: 'search', name: 'search_pick', item: '/a', detail: 'other' }).detail, 'dropdown')
})

test('a buy click keeps where the link sat, from a fixed list only', () => {
  assert.equal(clean({ kind: 'buy', detail: 'buybox' }).detail, 'buybox')
  assert.equal(clean({ kind: 'buy', detail: 'sidebar' }).detail, '')
  assert.equal(clean({ kind: 'read', detail: 'buybox' }).detail, '')
})
