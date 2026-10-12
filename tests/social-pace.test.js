// The Facebook Page poster's pace, cover choice and episode priority
// (scripts/social/pace.mjs, image.mjs, pick.mjs), with no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickNext, pickUrgent } from '../scripts/social/pick.mjs'
import { dueBy, isBehind, minuteOfDay, nextDueTime } from '../scripts/social/pace.mjs'
import { coverFolder, isSmallCover, largeCoverOf, preferBigCovers, resolveCover } from '../scripts/social/image.mjs'
import { SITE } from '../scripts/social/site.mjs'
import { NOW, HOUR, record, anime, cand, harness } from './social-kit.mjs'

// --- pace ---------------------------------------------------------------

/** Midnight US Eastern on 12 Oct 2026 (EDT, UTC-4). */
const DAY_START = Date.UTC(2026, 9, 12, 4, 0)

test('pace: 8 a day is one post every 3 hours, not 8 in the first 8 hours', () => {
  assert.equal(minuteOfDay(DAY_START), 0)
  assert.equal(minuteOfDay(NOW), 14 * 60)
  assert.equal(dueBy(DAY_START + 17 * 60_000, 8), 1)
  assert.equal(dueBy(DAY_START + 2 * HOUR + 59 * 60_000, 8), 1)
  assert.equal(dueBy(DAY_START + 3 * HOUR, 8), 2)
  assert.equal(dueBy(DAY_START + 23 * HOUR + 59 * 60_000, 8), 8)
  assert.equal(nextDueTime(1, 8), '03:00')
  assert.equal(nextDueTime(8, 8), null)

  // A whole day of hourly runs at 17 past: which hours post?
  const hoursFor = (perDay) => {
    const hours = []
    for (let h = 0; h < 24; h += 1) if (isBehind(hours.length, DAY_START + h * HOUR + 17 * 60_000, perDay)) hours.push(h)
    return hours
  }
  assert.deepEqual(hoursFor(8), [0, 3, 6, 9, 12, 15, 18, 21])
  assert.deepEqual(hoursFor(4), [0, 6, 12, 18])
  assert.equal(hoursFor(24).length, 24)
  assert.equal(hoursFor(15).length, 15)
})

test('pace: a lost run is caught up one post per later run, never in a burst', () => {
  // Nothing went out before 10:17 ET; three posts are overdue at 8 a day.
  const at = DAY_START + 10 * HOUR + 17 * 60_000
  assert.equal(dueBy(at, 8), 4)
  assert.equal(isBehind(0, at, 8), true)
  assert.equal(isBehind(3, at, 8), true)
  assert.equal(isBehind(4, at, 8), false)
})

test('run: a scheduled run posts once when behind and skips when on pace', async () => {
  const sent = []
  const graph = {
    pageName: async () => 'Page',
    publishPhoto: async ({ url }) => {
      sent.push(url)
      return { postId: 'p1' }
    },
    comment: async () => ({ commentId: 'c1' }),
  }
  const env = { FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', FB_POSTS_PER_DAY: '8', EVENT: 'schedule' }
  // 14:00 ET at 8 a day: five posts are due. With five already out the run skips.
  const onPace = harness(env, graph)
  const five = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, day: '2026-10-12', page: SITE.key, title: `T${i}`, status: 'posted', at: NOW }))
  await onPace.store.write({ v: 1, entries: five }, 0)
  assert.equal(await onPace.go(), 0)
  assert.equal(sent.length, 0)
  assert.match(onPace.text.join(''), /On pace: the next post is due at about 15:00 ET/)

  // With nothing out yet it is far behind, and still sends exactly one.
  const behind = harness(env, graph)
  assert.equal(await behind.go(), 0)
  assert.equal(sent.length, 1)
  assert.equal(behind.store.snapshot().entries.length, 1)
})

// --- covers -------------------------------------------------------------

const COVER = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover'
const headFetch = (found) => async (url, init) => {
  assert.equal(init.method, 'HEAD')
  const ok = found.includes(url)
  return { ok, headers: { get: () => (ok ? 'image/jpeg' : 'application/json') } }
}

test('image: only the size folder is swapped, and a missing large file falls back', async () => {
  assert.equal(coverFolder(`${COVER}/large/bx1-a.jpg`), 'large')
  assert.equal(isSmallCover(`${COVER}/medium/b1-a.jpg`), true)
  assert.equal(isSmallCover(`${COVER}/large/bx1-a.jpg`), false)
  assert.equal(isSmallCover('https://example.com/a.jpg'), false)
  assert.equal(largeCoverOf(`${COVER}/medium/b1-a.jpg`), `${COVER}/large/b1-a.jpg`)
  assert.equal(largeCoverOf(`${COVER}/large/bx1-a.jpg`), null)

  const small = `${COVER}/medium/bx7-z.jpg`
  assert.deepEqual(await resolveCover(small, { fetch: headFetch([`${COVER}/large/bx7-z.jpg`]) }), { url: `${COVER}/large/bx7-z.jpg`, small: false })
  assert.deepEqual(await resolveCover(small, { fetch: headFetch([]) }), { url: small, small: true })
  const broken = async () => Promise.reject(new Error('offline'))
  assert.deepEqual(await resolveCover(small, { fetch: broken }), { url: small, small: true })
  // A large cover is never fetched at all.
  assert.deepEqual(await resolveCover(`${COVER}/large/bx1-a.jpg`, { fetch: () => assert.fail('no request') }), { url: `${COVER}/large/bx1-a.jpg`, small: false })
})

test('image: a title with a small cover waits while one with a large cover is on offer', () => {
  const soft = { ...cand(record({ id: 40, slug: 'soft', title: 'Soft', cover: `${COVER}/medium/b40-a.jpg` })), recs: [] }
  const sharp = { ...cand(record({ id: 41, slug: 'sharp', title: 'Sharp' })), recs: [] }
  assert.deepEqual(preferBigCovers([soft, sharp]).map((c) => c.slug), ['sharp'])
  assert.deepEqual(preferBigCovers([soft]).map((c) => c.slug), ['soft'])
  for (let i = 0; i < 5; i += 1) assert.equal(pickNext({ pools: { new: [], old: [soft, sharp] }, now: NOW, rng: () => i / 5 }).candidate.slug, 'sharp')
  assert.equal(pickNext({ pools: { new: [], old: [soft] }, now: NOW, rng: () => 0 }).candidate.slug, 'soft')
})

// --- episodes first -----------------------------------------------------

test('pick: an episode airing today goes first when the day is short of room', () => {
  const eps = Array.from({ length: 3 }, (_, i) => cand(anime({ id: 50 + i, slug: `ep-${i}`, title: `Airing ${i}`, popularity: 9000 - i })))
  const evergreen = { ...cand(record()), recs: [{ title: 'Alpha' }, { title: 'Beta' }] }
  const pools = { new: [], old: [evergreen], today: eps }
  // Two NEW in a row: the usual mix would now take the evergreen title.
  const history = [{ mix: 'new', format: 'airing', title: 'A', at: NOW }, { mix: 'new', format: 'airing', title: 'B', at: NOW }]
  assert.equal(pickNext({ pools, history, now: NOW, rng: () => 0 }).candidate.slug, 'solo-leveling-1')
  // Three episodes, three posts left: the most popular episode wins, same format or not.
  const short = pickNext({ pools, history, now: NOW, rng: () => 0, slotsLeft: 3 })
  assert.deepEqual([short.candidate.slug, short.format, short.mix], ['ep-0', 'airing', 'new'])
  // Plenty of room (5 left, 3 episodes): the usual mix stands.
  assert.equal(pickNext({ pools, history, now: NOW, rng: () => 0, slotsLeft: 5 }).candidate.slug, 'solo-leveling-1')
  // An episode already posted is not offered again.
  const done = [...history, { mix: 'new', format: 'airing', title: 'Airing 0', at: NOW }]
  assert.equal(pickUrgent({ pools, fits: (c) => c.title !== 'Airing 0', slotsLeft: 2, now: NOW }).candidate.slug, 'ep-1')
  assert.equal(pickNext({ pools, history: done, now: NOW, rng: () => 0, slotsLeft: 2 }).candidate.slug, 'ep-1')
})
