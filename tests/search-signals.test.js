// Which hosts are search engines, how answer pages fold into their title,
// how a typed search is matched to a title, and that the night job and the
// 0005 backfill count search arrivals the same way.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyticsD1 } from './d1-shim.js'
import {
  engineOf,
  engineSql,
  titlePagePath,
  titlePageSql,
  buildNameIndex,
  searchTitleId,
} from '../src/lib/search-signals.js'
import { cleanRow, INSERT_SQL } from '../src/lib/beacon-rows.js'
import { runRollup } from '../src/lib/rollup.js'

const HOSTS = {
  'www.google.com': 'google',
  'google.com': 'google',
  'www.google.com.hk': 'google',
  'www.google.co.id': 'google',
  'com.google.android.googlequicksearchbox': 'google',
  'mail.google.com': '',
  'news.google.com': '',
  'www.bing.com': 'bing',
  'bing.com': 'bing',
  'cn.bing.com': 'bing',
  'yandex.ru': 'yandex',
  'yandex.com.tr': 'yandex',
  'wap.yandex.com': 'yandex',
  'duckduckgo.com': 'duckduckgo',
  'search.yahoo.com': 'yahoo',
  'search.brave.com': 'brave',
  'whereanime.com': '',
  'lm.facebook.com': '',
  'googlefake.com': '',
  '': '',
}

test('search engines are told apart from other sites', () => {
  for (const [host, engine] of Object.entries(HOSTS)) assert.equal(engineOf(host), engine, host)
})

test('the SQL and the JS agree on every host', () => {
  const d1 = analyticsD1()
  for (const [host, engine] of Object.entries(HOSTS)) {
    const got = d1.raw.prepare(`SELECT ${engineSql('?1')} AS e`).get(host).e
    assert.equal(got, engine, host)
  }
})

test('answer pages count for their title, in JS and in SQL', () => {
  const d1 = analyticsD1()
  const cases = {
    '/manhwa/solo-leveling/characters': '/manhwa/solo-leveling',
    '/manga/berserk/buy': '/manga/berserk',
    '/anime/frieren/free': '/anime/frieren',
    '/manga/x/like': '/manga/x',
    '/manga/like': '/manga/like',
    '/manga/berserk': '/manga/berserk',
    '/character/gilda-378058': '/character/gilda-378058',
    '/': '/',
  }
  for (const [path, page] of Object.entries(cases)) {
    assert.equal(titlePagePath(path), page, path)
    assert.equal(d1.raw.prepare(`SELECT ${titlePageSql('?1')} AS p`).get(path).p, page, `sql ${path}`)
  }
})

test('a typed search matches a title only by its exact name, never a shared one', () => {
  const names = buildNameIndex([
    { id: 1, title: 'Solo Leveling', titleRomaji: 'Na Honjaman Level Up', synonyms: ['Only I Level Up'] },
    { id: 2, title: 'Monster' },
    { id: 3, title: 'Monster', titleEnglish: 'Monster (Korean)' },
  ])
  const idOf = new Map([
    ['/manhwa/solo-leveling', 1],
    ['/manhwa/old-solo-slug', 1],
  ])
  assert.equal(searchTitleId({ name: 'search_pick', item: '/manhwa/solo-leveling' }, { idOf, names }), 1)
  assert.equal(searchTitleId({ name: 'search_pick', item: '/manhwa/solo-leveling/characters' }, { idOf, names }), 1)
  assert.equal(searchTitleId({ name: 'search_pick', item: '/manhwa/old-solo-slug' }, { idOf, names }), 1, 'old addresses too')
  assert.equal(searchTitleId({ name: 'search_pick', item: '/genre/action' }, { idOf, names }), null)
  assert.equal(searchTitleId({ name: 'search_none', item: 'only i level up' }, { idOf, names }), 1)
  assert.equal(searchTitleId({ name: 'search_none', item: 'ONLY I LEVEL UP' }, { idOf, names }), 1)
  assert.equal(searchTitleId({ name: 'search_none', item: 'only i level' }, { idOf, names }), null, 'exact only')
  assert.equal(searchTitleId({ name: 'search_none', item: 'monster' }, { idOf, names }), null, 'two titles share it')
  assert.equal(searchTitleId({ name: 'list_add', item: '1' }, { idOf, names }), null)
})

const NOW = Date.parse('2026-09-27T12:00:00Z')

function seed(d1) {
  const rows = [
    // Two people from Google on one title page and its characters page.
    { path: '/manga/a', referrer: 'www.google.com', visitor: 'v1', age: 1.2 },
    { path: '/manga/a/characters', referrer: 'www.google.co.id', visitor: 'v2', age: 1.2 },
    { path: '/manga/a', referrer: 'www.bing.com', visitor: 'v3', age: 1.2 },
    // Not a search engine, and a view from our own page.
    { path: '/manga/a', referrer: 'whereanime.com', visitor: 'v4', age: 1.2 },
    { path: '/manga/b', referrer: '', prev: '/', visitor: 'v5', age: 1.2 },
  ]
  for (const r of rows) {
    const values = cleanRow({ kind: 'view', name: 'page_view', page_type: 'manga', step: 1, ...r, age: r.age * 86400000 }, 'US', NOW)
    d1.raw.prepare(INSERT_SQL).run(...values)
  }
}

test('the night job rolls search arrivals up by page and engine', async () => {
  const d1 = analyticsD1()
  seed(d1)
  await runRollup(d1, NOW)
  const rows = d1.raw.prepare('SELECT path, engine, views, people FROM daily_search_arrivals ORDER BY path, engine').all()
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { path: '/manga/a', engine: 'bing', views: 1, people: 1 },
    { path: '/manga/a', engine: 'google', views: 1, people: 1 },
    { path: '/manga/a/characters', engine: 'google', views: 1, people: 1 },
  ])
})

test('the 0005 backfill fills closed days exactly as the night job does', async () => {
  const nightly = analyticsD1()
  seed(nightly)
  await runRollup(nightly, NOW)
  const backfilled = analyticsD1()
  seed(backfilled)
  await runRollup(backfilled, NOW)
  backfilled.raw.exec('DELETE FROM daily_search_arrivals')
  const sql = readFileSync(new URL('../db/migrations/0005-search-and-bots.sql', import.meta.url), 'utf8')
  backfilled.raw.exec(sql)
  backfilled.raw.exec(sql) // twice is safe
  const q = 'SELECT day, path, engine, views, people FROM daily_search_arrivals ORDER BY day, path, engine'
  assert.deepEqual(backfilled.raw.prepare(q).all(), nightly.raw.prepare(q).all())
})
