// The door's refused-hit counter: the reasons it gives, that a flood is
// written in few batches and few rows, and the jump hint on /my-admin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyticsD1 } from './d1-shim.js'
import { rejectCounter, writeRejects, upsertSql, REASONS, FLUSH_MS, MAX_KEYS } from '../src/lib/reject-count.js'
import { passProblem, readBeacon, beaconPlace, sign, MAX_BODY } from '../src/lib/beacon-pass.js'
import { botJumpHint, JUMP_MIN } from '../src/lib/admin-bots.js'

const env = { PASS_KEY: 'test-key' }
const NOW = Date.parse('2026-09-27T12:00:00Z')

async function passDying(at) {
  return `${at}.${await sign(env.PASS_KEY, String(at))}`
}

test('a good pass is let in, and each bad one says why', async () => {
  const good = await passDying(NOW + 60000)
  assert.equal(await passProblem(good, env, NOW), null)
  assert.equal(await passProblem(undefined, env, NOW), 'no_pass')
  assert.equal(await passProblem('', env, NOW), 'no_pass')
  assert.equal(await passProblem(42, env, NOW), 'no_pass')
  assert.equal(await passProblem(good, {}, NOW), 'no_pass', 'no key configured: nothing passes')
  assert.equal(await passProblem(await passDying(NOW - 1), env, NOW), 'old_pass')
  assert.equal(await passProblem(`${NOW + 60000}.deadbeef`, env, NOW), 'bad_pass')
  assert.equal(await passProblem('nodot', env, NOW), 'bad_pass')
  assert.equal(await passProblem('abc.def', env, NOW), 'bad_pass')
  // A pass signed with another key is forged.
  const other = `${NOW + 60000}.${await sign('other-key', String(NOW + 60000))}`
  assert.equal(await passProblem(other, env, NOW), 'bad_pass')
})

test('a beacon body is dropped for the same reasons as before', () => {
  assert.equal(readBeacon('').reason, 'bad_body')
  assert.equal(readBeacon('x'.repeat(MAX_BODY + 1)).reason, 'bad_body')
  assert.equal(readBeacon('{not json').reason, 'bad_json')
  assert.equal(readBeacon('null').reason, 'bad_json')
  assert.equal(readBeacon('7').reason, 'bad_json')
  assert.deepEqual(readBeacon('{"pass":"p","rows":[]}').body, { pass: 'p', rows: [] })
  assert.equal(beaconPlace({ rows: [{ page_type: 'manga' }] }), 'manga')
  assert.equal(beaconPlace({ page_type: 'anime' }), 'anime')
  assert.equal(beaconPlace({ rows: 'x' }), undefined)
})

test('every reason the worker can give has words for /my-admin', () => {
  for (const r of ['ok', 'pass_ok', 'no_pass', 'old_pass', 'bad_pass', 'bad_body', 'bad_json', 'bad_row', 'wrong_method', 'pass_bad_ask', 'pass_refused', 'pass_error']) {
    assert.ok(REASONS[r], r)
  }
})

test('the first hit after a quiet spell is written at once, then at most once a window', () => {
  const c = rejectCounter()
  c.add('no_pass', 'manga', 'US', NOW)
  const first = c.take(NOW)
  assert.equal(first.length, 1)
  assert.equal(first[0].n, 1)
  for (let i = 0; i < 5000; i += 1) c.add('no_pass', 'manga', 'US', NOW + 10 + i)
  assert.equal(c.take(NOW + 5000), null, 'inside the window: nothing written')
  const second = c.take(NOW + FLUSH_MS)
  assert.deepEqual(second, [{ day: '2026-09-27', reason: 'no_pass', place: 'manga', country: 'US', n: 5000 }])
  assert.equal(c.take(NOW + FLUSH_MS * 3), null, 'nothing pending, nothing written')
})

test('a flood from every country cannot widen a batch', () => {
  const c = rejectCounter()
  c.take(NOW) // start a window
  const codes = []
  for (let a = 65; a < 91; a += 1) for (let b = 65; b < 91; b += 1) codes.push(String.fromCharCode(a, b))
  for (const code of codes) c.add('bad_pass', 'home', code, NOW + 1)
  const rows = c.take(NOW + FLUSH_MS)
  assert.ok(rows.length <= MAX_KEYS + 1, `${rows.length} rows`)
  assert.equal(rows.reduce((n, r) => n + r.n, 0), codes.length, 'nothing lost, only folded')
  assert.ok(rows.some((r) => r.country === '--'))
})

test('made-up values are cleaned before they are counted', () => {
  const c = rejectCounter()
  c.add('no_pass', '<script>', 'united states', NOW)
  c.add('invented_reason', 'home', 'US', NOW)
  const rows = c.take(NOW)
  assert.deepEqual(rows, [{ day: '2026-09-27', reason: 'no_pass', place: 'other', country: '--', n: 1 }])
})

test('taken rows are added to the day in one batch, 20 rows per statement', async () => {
  const d1 = analyticsD1()
  let batches = 0
  const realBatch = d1.batch.bind(d1)
  d1.batch = async (list) => {
    batches += 1
    return realBatch(list)
  }
  // 45 distinct two-letter countries: three statements in one batch.
  const rows = Array.from({ length: 45 }, (_, i) => ({
    day: '2026-09-27', reason: 'no_pass', place: 'home',
    country: String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)), n: 1,
  }))
  await writeRejects(d1, rows)
  await writeRejects(d1, [{ day: '2026-09-27', reason: 'no_pass', place: 'home', country: 'AA', n: 4 }])
  assert.equal(batches, 2)
  const total = d1.raw.prepare('SELECT SUM(n) AS n, COUNT(*) AS c FROM daily_rejects').get()
  assert.deepEqual({ ...total }, { n: 49, c: 45 })
  assert.equal(d1.raw.prepare("SELECT n FROM daily_rejects WHERE country = 'AA'").get().n, 5)
  assert.match(upsertSql(2), /VALUES \(\?,\?,\?,\?,\?\),\(\?,\?,\?,\?,\?\)/)
})

test('a jump in refused hits is flagged, an ordinary day is not', () => {
  const quiet = Array.from({ length: 10 }, (_, i) => ({ day: `2026-09-${String(10 + i).padStart(2, '0')}`, rejected: 40 }))
  assert.equal(botJumpHint(quiet), null)
  const attack = [...quiet, { day: '2026-09-20', rejected: 5000 }]
  const hint = botJumpHint(attack)
  assert.equal(hint.level, 'act')
  assert.match(hint.text, /5,000 on 2026-09-20/)
  // Yesterday's jump is still said while today is quiet so far.
  assert.ok(botJumpHint([...attack, { day: '2026-09-21', rejected: 3 }]))
  // Small numbers are noise even at 10 times the usual.
  assert.equal(botJumpHint([...quiet.map((d) => ({ ...d, rejected: 2 })), { day: '2026-09-20', rejected: JUMP_MIN - 1 }]), null)
})
