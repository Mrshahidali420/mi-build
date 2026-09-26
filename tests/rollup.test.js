// The night job and the dashboard's raw questions, run for real against an
// in-memory SQLite with the schema from db/schema.sql.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyticsD1 } from './d1-shim.js'
import { cleanRow, INSERT_SQL } from '../src/lib/beacon-rows.js'
import { runRollup } from '../src/lib/rollup.js'
import { actionsFor, quickExitsFor } from '../src/lib/admin-more.js'
import { clicksFor } from '../src/lib/admin-data.js'

const DAY = '2026-09-20'
const AT = Date.parse(`${DAY}T12:00:00Z`)
// The night after DAY, when the cron runs.
const NIGHT = Date.parse('2026-09-21T00:10:00Z')

function write(d1, rows, at = AT) {
  const stmt = d1.raw.prepare(INSERT_SQL)
  for (const row of rows) {
    const values = cleanRow(row, 'US', at)
    if (values) stmt.run(...values)
  }
}

const view = (visitor, session, step, path) => ({ kind: 'view', name: 'page_view_scroll', path, page_type: path.split('/')[1], visitor, session, step })

function fixture() {
  const d1 = analyticsD1()
  write(d1, [
    // v1 arrives on /manga/a, does nothing, leaves: a quick exit.
    view('v1', 's1', 1, '/manga/a'),
    { kind: 'leave', name: 'leave', path: '/manga/a', visitor: 'v1', session: 's1', step: 1, dwell: 9000 },
    // v2 arrives on /manga/a and clicks out twice.
    view('v2', 's2', 1, '/manga/a'),
    { kind: 'read', name: 'read_webtoon', path: '/manga/a', page_type: 'manga', platform: 'WEBTOON', visitor: 'v2', session: 's2', step: 1 },
    { kind: 'buy', name: 'affiliate_amazon_pick_books', path: '/manga/a', page_type: 'manga', shop_kind: 'pick_books', detail: 'pick', visitor: 'v2', session: 's2', step: 1 },
    // v3 arrives on /manga/a and saves it: not a quick exit.
    view('v3', 's3', 1, '/manga/a'),
    { kind: 'act', name: 'list_add', item: '5', detail: 'PLANNING', label: 'Title A', path: '/manga/a', visitor: 'v3', session: 's3', step: 1 },
    // v4 hits a broken address. That is not a click.
    { kind: 'missing', name: 'not_found_scroll', path: '/nope', page_type: 'nope', visitor: 'v4', session: 's4', step: 1 },
    { kind: 'act', name: 'miss_next', item: '/anime', path: '/nope', visitor: 'v4', session: 's4', step: 1 },
    // v5 opens two pages.
    view('v5', 's5', 1, '/manga/b'),
    view('v5', 's5', 2, '/manga/c'),
    // Two people search the same missing words; one person searches other
    // words. Their own visits, so the quick exit above stays a quick exit.
    { kind: 'search', name: 'search_none', item: 'zzz title', detail: 'dropdown', visitor: 'v1', session: 's6', step: 1 },
    { kind: 'search', name: 'search_none', item: 'ZZZ  Title', detail: 'page', visitor: 'v2', session: 's7', step: 1 },
    { kind: 'search', name: 'search_none', item: 'only once', detail: 'page', visitor: 'v3', session: 's8', step: 1 },
    { kind: 'search', name: 'search_pick', item: '/manga/b', detail: 'dropdown', pos: 1, label: 'Title B', visitor: 'v5', session: 's5', step: 1 },
  ])
  // A visit that arrives on /manga/c and only searches is NOT a quick exit.
  write(d1, [
    view('v6', 's10', 1, '/manga/c'),
    { kind: 'search', name: 'search_pick', item: '/manga/b', detail: 'dropdown', pos: 2, label: 'Title B', visitor: 'v6', session: 's10', step: 1 },
  ])
  // A row old enough to be pruned.
  write(d1, [view('v9', 's9', 1, '/manga/old')], Date.parse('2026-08-01T12:00:00Z'))
  return d1
}

const all = (d1, sql, ...args) => d1.raw.prepare(sql).all(...args)

test('the night job rolls one day up correctly', async () => {
  const d1 = fixture()
  const out = await runRollup(d1, NIGHT)
  assert.equal(out.ok, true)
  assert.deepEqual(out.rolled.find((r) => r.day === DAY), { day: DAY, rows: 17 })
  assert.equal(out.pruned, 1)

  // A 404 is not a click, anywhere.
  const clickKinds = all(d1, 'SELECT DISTINCT kind FROM daily_clicks').map((r) => r.kind).sort()
  assert.deepEqual(clickKinds, ['buy', 'read'])
  const totals = all(d1, 'SELECT * FROM daily_totals WHERE day = ?', DAY)[0]
  assert.equal(totals.clicks, 2)
  assert.equal(totals.views, 6)
  assert.equal(totals.quick_exits, 1)

  const pageA = all(d1, 'SELECT * FROM daily_pages WHERE day = ? AND path = ?', DAY, '/manga/a')[0]
  assert.equal(pageA.entries, 3)
  assert.equal(pageA.quick_exits, 1)
  const pageB = all(d1, 'SELECT * FROM daily_pages WHERE day = ? AND path = ?', DAY, '/manga/b')[0]
  assert.equal(pageB.quick_exits, 0)
  const pageC = all(d1, 'SELECT * FROM daily_pages WHERE day = ? AND path = ?', DAY, '/manga/c')[0]
  assert.equal(pageC.quick_exits, 0, 'a search is doing something')

  const actions = all(d1, 'SELECT name, item, detail, label, n, people FROM daily_actions WHERE day = ? ORDER BY name, item', DAY)
  const find = (name, item) => actions.find((r) => r.name === name && r.item === item)
  assert.deepEqual({ ...find('list_add', '5') }, { name: 'list_add', item: '5', detail: 'PLANNING', label: 'Title A', n: 1, people: 1 })
  // Two people, one in the box and one on the full page: still two people.
  assert.equal(find('search_none', 'zzz title').people, 2)
  assert.equal(find('search_none', 'only once'), undefined, 'one-person words are never kept')
  const noneAll = actions.filter((r) => r.name === 'search_none_all')
  assert.equal(noneAll.reduce((n, r) => n + r.n, 0), 3, 'every miss is still counted, without words')
  assert.ok(noneAll.every((r) => r.item === ''))
  assert.deepEqual({ ...find('buy', '/manga/a') }, { name: 'buy', item: '/manga/a', detail: 'pick', label: 'pick_books', n: 1, people: 1 })
  assert.equal(find('miss_next', '/anime').n, 1)
  assert.equal(find('search_pick', '/manga/b').label, 'Title B')
  assert.equal(find('search_pick', '/manga/b').n, 2)
})

test('a second run changes nothing', async () => {
  const d1 = fixture()
  await runRollup(d1, NIGHT)
  const before = JSON.stringify(all(d1, 'SELECT * FROM daily_actions ORDER BY name, item, detail'))
  const again = await runRollup(d1, NIGHT)
  assert.equal(again.rolled.length, 0)
  assert.equal(JSON.stringify(all(d1, 'SELECT * FROM daily_actions ORDER BY name, item, detail')), before)
})

test('the dashboard asks the raw table the same questions', async () => {
  const d1 = fixture()
  const raw = { mode: 'raw', fromDay: DAY, toDay: DAY, sinceTs: 0 }
  const rows = await actionsFor(d1, raw, ['search_none', 'search_none_all', 'list_add'])
  assert.ok(rows.find((r) => r.item === 'zzz title'))
  assert.equal(rows.find((r) => r.item === 'only once'), undefined, 'one-person words are hidden today too')
  assert.equal(rows.filter((r) => r.name === 'search_none_all').reduce((n, r) => n + r.n, 0), 3)

  const quick = await quickExitsFor(d1, raw)
  assert.equal(quick.get('/manga/a'), 1)

  const clicks = await clicksFor(d1, raw)
  assert.deepEqual(clicks.map((r) => r.kind).sort(), ['buy', 'read'])
})

test('opens from the homepage are rolled up, and first_day never moves', async () => {
  const d1 = analyticsD1()
  const fromHome = (visitor, session, path) => ({ ...view(visitor, session, 2, path), prev: '/', prev_type: 'home' })
  write(d1, [
    view('h1', 'hs1', 1, '/'),
    fromHome('h1', 'hs1', '/manga/a'),
    view('h2', 'hs2', 1, '/'),
    fromHome('h2', 'hs2', '/manga/a'),
    // The same person opening it twice is two opens and one person.
    fromHome('h2', 'hs2', '/manga/a'),
    // Arriving on the page from somewhere else is not an open from home.
    view('h3', 'hs3', 1, '/manga/a'),
  ])
  await runRollup(d1, NIGHT)
  const rows = all(d1, 'SELECT path, views, people FROM daily_from_home WHERE day = ?', DAY)
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ path: '/manga/a', views: 3, people: 2 }])
  assert.equal(all(d1, 'SELECT first_day FROM total_pages WHERE path = ?', '/manga/a')[0].first_day, DAY)

  // The next night the page is seen again: first_day stays on the first night.
  const nextDay = '2026-09-21'
  write(d1, [view('h4', 'hs4', 1, '/manga/a')], Date.parse(`${nextDay}T12:00:00Z`))
  await runRollup(d1, Date.parse('2026-09-22T00:10:00Z'))
  const page = all(d1, 'SELECT first_day, last_day FROM total_pages WHERE path = ?', '/manga/a')[0]
  assert.equal(page.first_day, DAY)
  assert.equal(page.last_day, nextDay)
})

test('a long range adds the closed days to today', async () => {
  const d1 = fixture()
  await runRollup(d1, NIGHT)
  const today = '2026-09-21'
  write(d1, [{ kind: 'act', name: 'list_add', item: '5', detail: 'CURRENT', label: 'Title A', visitor: 'v7', session: 's7', step: 1 }], Date.parse(`${today}T09:00:00Z`))
  const mixed = { mode: 'mixed', fromDay: '2026-09-15', toDay: today, sinceTs: 0 }
  const rows = await actionsFor(d1, mixed, ['list_add'])
  assert.equal(rows.reduce((n, r) => n + r.n, 0), 2)
  const everything = await actionsFor(d1, { mode: 'all' }, ['list_add'])
  assert.equal(everything.reduce((n, r) => n + r.n, 0), 1, 'all time reads the closed days only')
})
