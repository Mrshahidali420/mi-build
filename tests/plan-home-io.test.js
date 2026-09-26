// The homepage planner's runner, with a fake D1. The one promise it must keep:
// whatever D1 does, the last good plan is left alone and the deploy goes on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPlan, QUERIES } from '../scripts/plan-home.mjs'
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
})
