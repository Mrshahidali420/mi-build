// The pace and the chain (pace.mjs, limits.mjs, chain.mjs, post.mjs): the
// five-minute gap, the rolling cap, the hand-over to the next run, what a
// failure and a limit signal do, and waiting when nothing is fresh. The clock
// is a fake that moves only when the run sleeps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GraphError, usageOf } from '../scripts/social/fb.mjs'
import { backoffMs, effectiveCap, signalOf, usageSignal, withPeak, withSignal, CUT_SHARE } from '../scripts/social/limits.mjs'
import { gapMinutesOf, nextWait, perDayOf, rollingCount, spacingMs, DAY_MS, DEFAULT_PER_DAY, HOUR_MS, MAX_PER_DAY, MINUTE_MS, MIN_GAP_MINUTES } from '../scripts/social/pace.mjs'
import { settingsOf } from '../scripts/social/post.mjs'
import { IDLE_MS, MAX_FAILS } from '../scripts/social/chain.mjs'
import { SITE } from '../scripts/social/site.mjs'
import { NOW, harness } from './social-kit.mjs'

const MIN = MINUTE_MS
const at = (minutesAgo) => ({ at: NOW - minutesAgo * MIN, page: SITE.key, status: 'posted' })

// --- the rules ---------------------------------------------------------------

test('gap: never closer than five minutes to the last entry in the ledger', () => {
  assert.deepEqual([gapMinutesOf(undefined), gapMinutesOf('1'), gapMinutesOf('0'), gapMinutesOf('abc'), gapMinutesOf('12')], [5, 5, 5, 5, 12])
  assert.equal(MIN_GAP_MINUTES, 5)
  const two = nextWait({ entries: [at(2)], now: NOW, cap: MAX_PER_DAY, gapMinutes: 5 })
  assert.deepEqual([two.ms, two.why], [3 * MIN, 'gap'])
  assert.equal(nextWait({ entries: [at(5)], now: NOW, cap: MAX_PER_DAY, gapMinutes: 5 }).ms, 0)
  assert.equal(nextWait({ entries: [], now: NOW, cap: 24 }).ms, 0)
  // A failed post and a claim count like a post; the gap is read from the ledger, not from the run.
  assert.equal(nextWait({ entries: [{ ...at(1), status: 'failed' }], now: NOW, cap: MAX_PER_DAY }).ms, 4 * MIN)
})

test('cap: unset means 24 a day, the ceiling is 288, and the posts are spread evenly', () => {
  assert.deepEqual([perDayOf(undefined), perDayOf(''), perDayOf('0'), perDayOf('24'), perDayOf('100'), perDayOf('999')], [24, 24, 24, 24, 100, 288])
  assert.deepEqual([DEFAULT_PER_DAY, MAX_PER_DAY], [24, 288])
  assert.equal(settingsOf({}).perDay, 24)
  assert.deepEqual([spacingMs(24, 5), spacingMs(48, 5), spacingMs(288, 5), spacingMs(288, 10)], [60 * MIN, 30 * MIN, 5 * MIN, 10 * MIN])
  const paced = nextWait({ entries: [at(20)], now: NOW, cap: 24 })
  assert.deepEqual([paced.ms, paced.why], [40 * MIN, 'pace'])
  // A manual run keeps the gap and the cap, not the even pace.
  assert.equal(nextWait({ entries: [at(20)], now: NOW, cap: 24, even: false }).ms, 0)
})

test('cap: the day is a rolling 24 hours, so a day boundary never allows a burst', () => {
  // 24 posts, one an hour, the last one an hour ago: the window is full whatever the calendar says.
  const full = Array.from({ length: 24 }, (_, i) => at(60 + i * 59))
  assert.equal(rollingCount(full, NOW), 24)
  const wait = nextWait({ entries: full, now: NOW, cap: 24 })
  assert.equal(wait.why, 'cap')
  assert.equal(wait.at, full.at(-1).at + DAY_MS) // room again when the oldest turns 24 hours old
  // An entry older than 24 hours no longer counts.
  assert.equal(rollingCount([at(24 * 60 + 1), at(30)], NOW), 1)
  // A block and a back-off outrank everything else.
  assert.equal(nextWait({ entries: [], now: NOW, cap: 24, blockedUntil: NOW + HOUR_MS }).why, 'block')
  assert.equal(nextWait({ entries: [at(1)], now: NOW, cap: 24, holdUntil: NOW + 2 * HOUR_MS }).why, 'backoff')
})

test('limits: which answers are signals, how long the back-off is, and what a block costs', () => {
  for (const code of [4, 17, 32, 613, 341, 80001]) assert.equal(signalOf(new GraphError('x', { code })).kind, 'throttle', String(code))
  assert.equal(signalOf(new GraphError('x', { code: 368 })).kind, 'block')
  assert.equal(signalOf(new GraphError('Your account is temporarily blocked from posting', { code: 1 })).kind, 'block')
  assert.equal(signalOf(new GraphError('It looks like spam', { code: 200 })).kind, 'block')
  assert.equal(signalOf(new GraphError('HTTP 429', { status: 429 })).kind, 'throttle')
  assert.equal(signalOf(new GraphError('Invalid parameter', { code: 100 })), null)
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => backoffMs(n, 5) / MIN), [10, 20, 40, 60, 60]) // doubles, an hour at most
  assert.equal(usageSignal({ pct: 95, source: 'x-app-usage' }).kind, 'throttle')
  assert.equal(usageSignal({ pct: 40, source: 'x-app-usage' }), null)

  const blocked = withSignal({}, { kind: 'block', code: 368, note: 'blocked' }, { now: NOW, reached: 20, perDay: 24 })
  assert.deepEqual([blocked.blockedUntil, blocked.cut.cap, blocked.signals.length, CUT_SHARE], [NOW + DAY_MS, 15, 1, 0.75])
  assert.equal(effectiveCap(blocked, 24), 15)
  assert.equal(effectiveCap(blocked, 30), 30) // the owner changed the number by hand: the cut is lifted
  assert.equal(effectiveCap({}, 24), 24)
  const slow = withSignal({}, { kind: 'throttle', code: 32, note: 'limit' }, { now: NOW, reached: 3, perDay: 24 })
  assert.deepEqual([slow.blockedUntil, slow.cut], [0, null])
  assert.equal(withPeak(withPeak({}, { pct: 40, source: 'a' }, NOW), { pct: 12, source: 'b' }, NOW + 1).peak.pct, 40)
})

test('usage: the highest percentage in the usage headers is read', () => {
  const headers = (map) => ({ get: (name) => map[name] || null })
  assert.deepEqual(usageOf(headers({ 'x-app-usage': '{"call_count":12,"total_cputime":3,"total_time":40}' })), { pct: 40, source: 'x-app-usage' })
  assert.deepEqual(usageOf(headers({ 'x-app-usage': '{"call_count":2}', 'x-business-use-case-usage': '{"123":[{"type":"pages","call_count":71,"total_time":5}]}' })), { pct: 71, source: 'x-business-use-case-usage' })
  assert.equal(usageOf(headers({})), null)
  assert.equal(usageOf(headers({ 'x-page-usage': 'not json' })), null)
  assert.equal(usageOf(undefined), null)
})

// --- a whole chain -------------------------------------------------------------

const wording = [(p) => ({ hook: `🔥 ${p.item} is here.`, facts: ['One fact.'], cta: '👇 Link in the first comment.' })]
const kind = (key, count) => ({ key, name: key, urgent: false, gapDays: 300, titleGap: false, window: 1, captions: wording, find: () => Array.from({ length: count }, (_, i) => ({ item: `${key}-${i}`, title: null, path: '/x', label: 'More', art: {}, view: {} })) })
const LIVE = { FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', EVENT: 'workflow_dispatch', FB_POST_TYPES: 'a' }

/** A run with made-up posts on tap. `fail(n)` may throw for the n-th photo call. */
function chain(env, { items = 60, fail = () => null, usage = () => null } = {}) {
  const sent = []
  let calls = 0
  let loads = 0
  const graph = {
    pageName: async () => 'Page',
    usage,
    publishPhotoFile: async () => {
      calls += 1
      const error = fail(calls)
      if (error) throw error
      sent.push(h.clock())
      return { postId: `p${calls}` }
    },
    comment: async () => ({ commentId: 'c' }),
  }
  const h = harness({ ...LIVE, ...env }, graph)
  const go = () =>
    h.run({
      loadPools: async () => {
        loads += 1
        return { pools: { new: [], old: [] }, data: {}, source: 'test' }
      },
      loadTypes: async () => [kind('a', items)],
      render: async () => ({ png: Buffer.from('p'), jpeg: Buffer.from('j') }),
    })
  return { ...h, go, sent, loads: () => loads, health: () => h.store.snapshot().health || {} }
}
const minutesIn = (times) => times.map((t) => (t - NOW) / MIN)

test('chain: one run posts, waits and posts again, then hands over to the next', async () => {
  const c = chain({ FB_CHAIN_MINUTES: '180' })
  assert.equal(await c.go(), 0)
  assert.deepEqual(minutesIn(c.sent), [0, 60, 120]) // 24 a day: one an hour
  assert.equal(c.outputs.chain, 'next')
  assert.equal(c.clock(), NOW + 180 * MIN) // it stays alive to its own end, so runs never pile up
  assert.match(c.text.join(''), /waiting 60 min \(the even pace\)/)
  assert.match(c.text.join(''), /Handing over to the next run of the chain/)
  assert.match(c.text.join(''), /Highest usage seen this run/)
})

test('chain: with the cap raised to the ceiling the posts are five minutes apart, never closer', async () => {
  const c = chain({ FB_CHAIN_MINUTES: '30', FB_POSTS_PER_DAY: '288', FB_MIN_GAP_MINUTES: '1' })
  assert.equal(await c.go(), 0)
  assert.deepEqual(minutesIn(c.sent), [0, 5, 10, 15, 20, 25])
  // The successor reads the same ledger: its first post waits for the gap too.
  const next = chain({ FB_CHAIN_MINUTES: '10', FB_POSTS_PER_DAY: '288' })
  await next.store.write({ v: 1, entries: [at(2)] }, 0)
  await next.go()
  assert.deepEqual(minutesIn(next.sent), [3, 8])
})

test('chain: a full rolling day posts nothing, and still hands over', async () => {
  const c = chain({ FB_CHAIN_MINUTES: '45' })
  await c.store.write({ v: 1, entries: Array.from({ length: 24 }, (_, i) => at(61 + i * 55)) }, 0)
  assert.equal(await c.go(), 0)
  assert.equal(c.sent.length, 0)
  assert.equal(c.outputs.chain, 'next')
  assert.match(c.text.join(''), /Last 24 hours: 24 of 24 posts used/)
})

test('hand-over: a dry run and a counted manual run never start a chain', async () => {
  assert.deepEqual([settingsOf(LIVE).mode, settingsOf({ ...LIVE, DRY_RUN: 'true' }).mode, settingsOf({ ...LIVE, COUNT: '2' }).mode, settingsOf({ ...LIVE, FB_POST_ENABLED: 'false' }).mode, settingsOf({ ...LIVE, EVENT: 'schedule' }).mode], ['chain', 'dry', 'manual', 'dry', 'chain'])
  const dry = chain({ DRY_RUN: 'true', COUNT: '2', FB_CHAIN_MINUTES: '180' })
  assert.equal(await dry.go(), 0)
  assert.deepEqual([dry.outputs.chain, dry.sent.length, (dry.store.snapshot().entries || []).length], ['stop', 0, 0])
  // A manual run sends its count, five minutes apart, inside the cap, and ends.
  const manual = chain({ COUNT: '2' })
  assert.equal(await manual.go(), 0)
  assert.deepEqual([manual.outputs.chain, minutesIn(manual.sent)], ['stop', [0, 5]])
})

test('failure: one failed post does not stop the chain; five in a row do', async () => {
  const once = chain({ FB_CHAIN_MINUTES: '130' }, { fail: (n) => (n === 1 ? new GraphError('Invalid parameter', { code: 100 }) : null) })
  assert.equal(await once.go(), 0)
  assert.deepEqual(minutesIn(once.sent), [60, 120]) // the failure took a slot; the loop went on after the gap
  assert.equal(once.outputs.chain, 'next')
  assert.deepEqual(once.store.snapshot().entries.map((e) => e.status), ['failed', 'posted', 'posted'])
  assert.equal(once.health().halted ?? null, null)

  const dead = chain({ FB_CHAIN_MINUTES: '300', FB_POSTS_PER_DAY: '288' }, { fail: () => new GraphError('Invalid parameter', { code: 100 }) })
  assert.equal(await dead.go(), 1)
  assert.deepEqual([dead.outputs.chain, dead.store.snapshot().entries.length, MAX_FAILS], ['stop', 5, 5])
  assert.match(dead.health().halted.why, /5 failures in a row/)
  // The watch job does not restart a halted chain; a start by hand clears the note.
  const watch = chain({ STARTED_BY: 'watch' })
  await watch.store.write(dead.store.snapshot(), 0)
  assert.equal(await watch.go(), 0)
  assert.equal(watch.sent.length, 0)
  assert.match(watch.text.join(''), /The chain was halted/)
})

test('failure: a refused token stops the chain at once', async () => {
  const c = chain({ FB_CHAIN_MINUTES: '300' }, { fail: () => new GraphError('Error validating access token', { code: 190, type: 'OAuthException' }) })
  assert.equal(await c.go(), 1)
  assert.deepEqual([c.outputs.chain, c.store.snapshot().entries.length], ['stop', 1])
  assert.match(c.health().halted.why, /token was refused/)
  assert.match(c.text.join(''), /The Page token was refused/)
})

test('back-off: a throttle signal doubles the wait, and is written down', async () => {
  const c = chain({ FB_CHAIN_MINUTES: '100', FB_POSTS_PER_DAY: '288' }, { fail: (n) => (n <= 2 ? new GraphError('Page request limit reached', { code: 32 }) : null) })
  assert.equal(await c.go(), 0)
  // Tries at 0 and 10 are throttled; the next waits 20 minutes, then the usual five.
  assert.deepEqual(minutesIn(c.sent).slice(0, 3), [30, 35, 40])
  assert.deepEqual(c.health().signals.map((s) => [s.kind, s.code]), [['throttle', 32], ['throttle', 32]])
  assert.match(c.text.join(''), /Backing off for 10 minutes/)
  assert.match(c.text.join(''), /Backing off for 20 minutes/)
})

test('block: posting stops for 24 hours and the cap drops to 75% of what was reached', async () => {
  const c = chain({ FB_CHAIN_MINUTES: '200', FB_POSTS_PER_DAY: '288' }, { fail: (n) => (n === 9 ? new GraphError('You are temporarily blocked from posting', { code: 368 }) : null) })
  assert.equal(await c.go(), 0)
  assert.equal(c.sent.length, 8)
  const health = c.health()
  assert.deepEqual([health.cut.cap, health.cut.reached, health.cut.perDay], [6, 8, 288])
  assert.equal(health.blockedUntil, c.sent.at(-1) + 5 * MIN + DAY_MS)
  assert.equal(c.outputs.chain, 'next') // the chain lives on; it only waits
  assert.match(c.text.join(''), /Facebook signalled a block/)
  // The next run sees the block and the cut cap in its first lines.
  const next = chain({ FB_CHAIN_MINUTES: '30', FB_POSTS_PER_DAY: '288' })
  await next.store.write(c.store.snapshot(), 0)
  await next.go()
  assert.equal(next.sent.length, 0)
  assert.match(next.text.join(''), /The cap of 288 is cut to 6/)
})

test('usage: the highest percentage is printed, kept in the ledger, and slows the chain near the limit', async () => {
  const c = chain({ FB_CHAIN_MINUTES: '40', FB_POSTS_PER_DAY: '288' }, { usage: () => ({ pct: 95, source: 'x-app-usage' }) })
  assert.equal(await c.go(), 0)
  assert.match(c.text.join(''), /Highest usage seen this run: \*\*95%\*\* \(x-app-usage\)/)
  assert.equal(c.health().peak.pct, 95)
  assert.deepEqual(minutesIn(c.sent), [0, 10, 30]) // each post is followed by a longer back-off
})

test('supply: with nothing fresh the chain waits and looks again; it never repeats an item', async () => {
  const c = chain({ FB_CHAIN_MINUTES: '70', FB_POSTS_PER_DAY: '288' }, { items: 2 })
  assert.equal(await c.go(), 0)
  assert.deepEqual(minutesIn(c.sent), [0, 5])
  assert.ok(c.loads() >= 3) // the data is read again each time it looks
  assert.match(c.text.join(''), /nothing fresh to post/)
  assert.equal(IDLE_MS, 20 * MIN)
  assert.equal(c.outputs.chain, 'next')
})
