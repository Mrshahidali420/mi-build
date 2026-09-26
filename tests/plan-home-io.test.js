// The homepage planner's runner, with a fake D1. The one promise it must keep:
// whatever D1 does, the last good plan is left alone and the deploy goes on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPlan, QUERIES, statsFrom, loopFrom, handoffFrom } from '../scripts/plan-home.mjs'
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
