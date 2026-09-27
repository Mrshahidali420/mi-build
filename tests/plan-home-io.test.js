// The homepage planner's runner, with a fake D1. The one promise it must keep:
// whatever D1 does, the last good plan is left alone and the deploy goes on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPlan, QUERIES, SEARCH_QUERIES, statsFrom, loopFrom, handoffFrom, searchStatsInto } from '../scripts/plan-home.mjs'
import { buildNameIndex } from '../src/lib/search-signals.js'
import { D1Error } from '../src/lib/d1-api.mjs'

const NIGHT = '2026-09-27'
const SEED = JSON.stringify({ night: '2026-09-20', source: 'd1', sections: { saving: { enabled: false, items: [] } }, cooldown: {} }, null, 2)

function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'plan-home-'))
  const comics = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, kind: 'comic', country: 'KR', title: `Title ${i + 1}`, slug: `t-${i + 1}`,
    genres: ['Action'], tags: [], popularity: i < 20 ? 100000 - i : 5000,
  }))
  comics.push({ id: 99, kind: 'comic', country: 'KR', title: 'Lolicon Saga', slug: 'ls', genres: [], tags: [], popularity: 1 })
  writeFileSync(join(dir, 'comics.json'), JSON.stringify(comics))
  writeFileSync(join(dir, 'anime.json'), '[]')
  const entries = {}
  for (const c of comics) entries[`t:${c.id}`] = { ns: 'manhwa', slug: c.slug, raw: c.slug, past: [] }
  writeFileSync(join(dir, 'slug-registry.json'), JSON.stringify({ version: 1, entries }))
  writeFileSync(join(dir, 'block.json'), JSON.stringify({ media: [] }))
  copyFileSync(new URL('../data/home-rules.json', import.meta.url), join(dir, 'home-rules.json'))
  writeFileSync(join(dir, 'home-auto.json'), SEED)
  writeFileSync(join(dir, 'home-decisions.json'), '[]\n')
  return dir
}

const quiet = () => {}
const read = (dir, name) => readFileSync(join(dir, name), 'utf8')

test('D1 unreachable: the plan file is untouched and one skip line is written', async () => {
  const dir = dataDir()
  const query = async () => { throw new D1Error('D1 unreachable: timed out') }
  const out = await runPlan({ query, dataDir: dir, night: NIGHT, say: quiet })
  assert.equal(out.ok, false)
  assert.equal(read(dir, 'home-auto.json'), SEED, 'byte-identical')
  const log = JSON.parse(read(dir, 'home-decisions.json'))
  assert.equal(log.length, 1)
  assert.deepEqual({ action: log[0].action, reason: log[0].reason }, { action: 'skip', reason: 'D1 unreachable: timed out' })
})

test('a token without D1 read is a skip, not a failure', async () => {
  const dir = dataDir()
  const query = async () => { throw new D1Error('D1 answered 403: the token has no D1 read permission') }
  const out = await runPlan({ query, dataDir: dir, night: NIGHT, say: quiet })
  assert.match(out.reason, /403/)
  assert.equal(read(dir, 'home-auto.json'), SEED)
})

test("last night's rollup missing: skip", async () => {
  const dir = dataDir()
  const out = await runPlan({ query: async () => [], dataDir: dir, night: NIGHT, say: quiet })
  assert.match(out.reason, /has not closed 2026-09-26/)
  assert.equal(read(dir, 'home-auto.json'), SEED)
})

test('a malformed answer: skip', async () => {
  const dir = dataDir()
  const query = async (sql) => (sql === QUERIES.rollup ? [{ day: '2026-09-26' }] : { nope: true })
  const out = await runPlan({ query, dataDir: dir, night: NIGHT, say: quiet })
  assert.match(out.reason, /malformed/)
  assert.equal(read(dir, 'home-auto.json'), SEED)
})

test('a good answer writes both files, with the guardrails applied', async () => {
  const dir = dataDir()
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']
  // Titles 21 to 28 are outside Trending (the top 18) and qualify; title 1 is
  // in Trending; Lolicon Saga has the numbers but not the name.
  const ids = [1, 21, 22, 23, 24, 25, 26, 27, 28, 99]
  const answers = {
    [QUERIES.rollup]: [{ day: '2026-09-26' }],
    [QUERIES.history]: [{ day: '2026-09-01' }],
    [QUERIES.firsts]: [],
    [QUERIES.homeActs]: [],
    [QUERIES.ownerRules]: [],
    [QUERIES.pages]: ids.flatMap((id) => days.map((day) => ({ day, path: `/manhwa/${id === 99 ? 'ls' : `t-${id}`}`, views: 50, people: 10, entries: 5, quick_exits: 1 }))),
    [QUERIES.actions]: ids.flatMap((id) => days.slice(0, 4).map((day) => ({ day, name: 'list_add', item: String(id), n: 3 }))),
    [QUERIES.savers]: ids.map((id) => ({ item: String(id), people: 12 })),
    [QUERIES.home]: days.map((day) => ({ day, views: 500 })),
    [QUERIES.fromHome]: [],
  }
  const query = async (sql) => answers[sql]
  const out = await runPlan({ query, dataDir: dir, night: NIGHT, say: quiet })
  assert.equal(out.ok, true)
  const plan = JSON.parse(read(dir, 'home-auto.json'))
  assert.equal(plan.night, NIGHT)
  const got = plan.sections.saving.items.map((it) => it.id)
  assert.equal(got.length, 3, 'the change cap holds on the first night')
  assert.ok(!got.includes(1), 'Trending titles are not shown twice')
  assert.ok(!got.includes(99), 'Lolicon Saga is refused')
  assert.equal(plan.sections.saving.enabled, false, '3 is under the floor of 6')
  const log = JSON.parse(read(dir, 'home-decisions.json'))
  assert.ok(log.some((d) => d.id === 99 && d.action === 'block'))
  assert.equal(log.filter((d) => d.action === 'add').length, 3)
  // The hand-off file for unlicensed pages: counts per id, 30 days.
  const handoff = JSON.parse(read(dir, 'handoff.json'))
  assert.equal(handoff.night, NIGHT)
  assert.deepEqual(handoff.pages['21'], [300, 0])
  assert.equal(Object.keys(handoff.pages).length, ids.length)
})

test('a skipped night writes no hand-off file', async () => {
  const dir = dataDir()
  await runPlan({ query: async () => [], dataDir: dir, night: NIGHT, say: quiet })
  assert.throws(() => read(dir, 'handoff.json'))
})

test('the hand-off file leaves out pages under the floor', () => {
  const stats = new Map([[2, { opens30: 29, outs30: 5 }], [1, { opens30: 30, outs30: 3 }]])
  assert.deepEqual(handoffFrom(stats, NIGHT).pages, { 1: [30, 3] })
})

test('the runner cuts yesterday, the week and the month from 30 days of page rows', () => {
  const idOf = new Map([['/manhwa/a', 1], ['/manhwa/a-old', 1], ['/manhwa/b', 2]])
  const rows = {
    actions: [{ day: '2026-09-25', name: 'list_add', item: '1', n: 2 }],
    savers: [{ item: '1', people: 2 }],
    pages: [
      { day: '2026-09-01', path: '/manhwa/a', views: 100, people: 50, clicks: 4, entries: 9, quick_exits: 1 },
      { day: '2026-09-22', path: '/manhwa/a', views: 20, people: 10, clicks: 1, entries: 2, quick_exits: 0 },
      { day: '2026-09-26', path: '/manhwa/a-old', views: 5, people: 5, clicks: 0, entries: 1, quick_exits: 1 },
      { day: '2026-09-26', path: '/manhwa/b', views: 7, people: 7, clicks: 0, entries: 0, quick_exits: 0 },
      { day: '2026-09-26', path: '/elsewhere', views: 99, people: 99, clicks: 0, entries: 0, quick_exits: 0 },
    ],
    firsts: [{ path: '/manhwa/b', first_day: '2026-09-20' }, { path: '/manhwa/a-old', first_day: '2026-09-02' }],
  }
  const stats = statsFrom(rows, idOf, { last: '2026-09-26', from7: '2026-09-20' })
  const a = stats.get(1)
  assert.deepEqual(
    [a.opens1, a.opens7, a.opens30, a.people7, a.people30, a.outs7, a.outs30, a.daysSeen7, a.entries7, a.quick7],
    [5, 25, 125, 15, 65, 1, 5, 2, 3, 1]
  )
  assert.equal(a.saves7, 2)
  assert.equal(a.firstDay, '2026-09-02')
  assert.equal(stats.get(2).firstDay, '2026-09-20', 'a title nobody saved is looked at too')
  assert.equal(stats.size, 2)
})

test('the homepage rows become per-shelf seen counts and per-slot clicks', () => {
  const loop = loopFrom({
    home: [{ day: '2026-09-26', views: 300 }],
    fromHome: [],
    homeActs: [
      { day: '2026-09-26', name: 'home_seen', item: '', detail: 'rising-saving', n: 40 },
      { day: '2026-09-26', name: 'home_seen', item: '', detail: 'saving', n: 10 },
      { day: '2026-09-26', name: 'home_click', item: '7', detail: 'saving', n: 3 },
    ],
  })
  assert.deepEqual(loop.seen['2026-09-26'], { rising: 40, saving: 50 })
  assert.deepEqual(loop.clicks.get('saving:7'), { '2026-09-26': 3 })
  assert.equal(loop.homeViews['2026-09-26'], 300)
})

test('search arrivals and our own searches become per-title numbers', () => {
  const idOf = new Map([['/manga/a', 1], ['/manga/a-old', 1], ['/manga/b', 2]])
  const names = buildNameIndex([{ id: 2, title: 'Bee Story' }])
  const rows = {
    arrivals: [
      { day: '2026-09-26', path: '/manga/a', engine: 'google', views: 4 },
      { day: '2026-09-25', path: '/manga/a/characters', engine: 'google', views: 3 },
      { day: '2026-09-24', path: '/manga/a-old', engine: 'bing', views: 2 },
      { day: '2026-09-02', path: '/manga/a', engine: 'google', views: 10 },
      { day: '2026-09-26', path: '/genre/action', engine: 'google', views: 50 },
    ],
    arrivalPeople: [{ page: '/manga/a', people: 7, days: 3 }, { page: '/manga/a-old', people: 1, days: 1 }],
    searches: [
      { name: 'search_pick', item: '/manga/b', visitor: 'v1', day: '2026-09-25' },
      { name: 'search_pick', item: '/manga/b/buy', visitor: 'v1', day: '2026-09-26' },
      { name: 'search_none', item: 'bee story', visitor: 'v2', day: '2026-09-26' },
      { name: 'search_none', item: 'nothing like it', visitor: 'v3', day: '2026-09-26' },
    ],
  }
  const stats = searchStatsInto(new Map(), rows, idOf, names, { last: '2026-09-26', from7: '2026-09-20' })
  const a = stats.get(1)
  assert.deepEqual([a.g1, a.g7, a.g30, a.gGoogle7, a.gPeople7, a.gDays7], [4, 9, 19, 7, 8, 3])
  const b = stats.get(2)
  assert.deepEqual([b.s7, b.sPeople7, b.sDays7], [3, 2, 2], 'a pick, an answer-page pick and an exact name')
  assert.equal(stats.size, 2, 'a genre page and an unmatched search are no title')
})

test('the search questions failing costs only the new shelf', async () => {
  const dir = dataDir()
  const answers = {
    [QUERIES.rollup]: [{ day: '2026-09-26' }],
    [QUERIES.history]: [{ day: '2026-09-01' }],
  }
  const query = async (sql) => {
    if (Object.values(SEARCH_QUERIES).includes(sql)) throw new D1Error('no such table: daily_search_arrivals')
    return answers[sql] || []
  }
  const said = []
  const out = await runPlan({ query, dataDir: dir, night: NIGHT, say: (line) => said.push(line) })
  assert.equal(out.ok, true)
  assert.ok(said.some((line) => /Hot this week shelf stays empty/.test(line)))
  assert.deepEqual(out.plan.sections.searching.items, [])
})

// ------------------------------------------------ the owner's buttons (D1)

/** The good night from above, with the owner's rules as D1 would send them. */
function goodNight(ownerRules) {
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']
  const ids = [21, 22, 23, 24, 25, 26, 27, 28, 99]
  const answers = {
    [QUERIES.rollup]: [{ day: '2026-09-26' }],
    [QUERIES.history]: [{ day: '2026-09-01' }],
    [QUERIES.pages]: ids.flatMap((id) => days.map((day) => ({ day, path: `/manhwa/${id === 99 ? 'ls' : `t-${id}`}`, views: 50, people: 10, entries: 5, quick_exits: 1 }))),
    [QUERIES.actions]: ids.flatMap((id) => days.slice(0, 4).map((day) => ({ day, name: 'list_add', item: String(id), n: 3 }))),
    [QUERIES.savers]: ids.map((id) => ({ item: String(id), people: 12 })),
    [QUERIES.home]: days.map((day) => ({ day, views: 500 })),
    [QUERIES.ownerRules]: ownerRules,
  }
  return async (sql) => answers[sql] ?? []
}

test('a ban from the buttons keeps a title off; a pin from the buttons puts one in', async () => {
  const dir = dataDir()
  // 28 would be picked on the numbers; 29 has no numbers at all (and 1 to 20
  // sit in Trending, where a pin is refused as already on the homepage).
  const query = goodNight([
    { anilist_id: 28, action: 'ban', section: '' },
    { anilist_id: 29, action: 'pin', section: 'saving' },
  ])
  const out = await runPlan({ query, dataDir: dir, night: NIGHT, say: quiet })
  assert.equal(out.ok, true)
  const got = out.plan.sections.saving.items
  assert.ok(!Object.values(out.plan.sections).some((s) => s.items.some((it) => it.id === 28)), 'banned everywhere')
  assert.equal(got[0].id, 29, 'the pin leads its shelf')
  assert.ok(got[0].pinned)
})

test('a pin from the buttons never bypasses the adult filter', async () => {
  const dir = dataDir()
  // 99 is "Lolicon Saga": the pin is a request, and it is refused.
  const out = await runPlan({ query: goodNight([{ anilist_id: 99, action: 'pin', section: 'saving' }]), dataDir: dir, night: NIGHT, say: quiet })
  assert.equal(out.ok, true)
  assert.ok(!Object.values(out.plan.sections).some((s) => s.items.some((it) => it.id === 99)))
  assert.ok(out.decisions.some((d) => d.id === 99 && d.action === 'block' && /pin refused/.test(d.reason)))
})

test('owner rules that cannot be read skip the night and keep the last plan', async () => {
  const dir = dataDir()
  const good = goodNight([])
  const query = async (sql, params) => {
    if (sql === QUERIES.ownerRules) throw new D1Error('D1 answered 400: no such table: home_rules')
    return good(sql, params)
  }
  const out = await runPlan({ query, dataDir: dir, night: NIGHT, say: quiet })
  assert.equal(out.ok, false)
  assert.match(out.reason, /home_rules/)
  assert.equal(read(dir, 'home-auto.json'), SEED)
})
