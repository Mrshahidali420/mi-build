// The Facebook Page poster's cover choice and episode priority
// (scripts/social/image.mjs, pick.mjs), with no network. The pace has its
// own file (social-chain.test.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickNext, pickUrgent } from '../scripts/social/pick.mjs'
import { coverFolder, isSmallCover, largeCoverOf, preferBigCovers, resolveCover } from '../scripts/social/image.mjs'
import { SITE } from '../scripts/social/site.mjs'
import { NOW, HOUR, record, anime, cand, harness } from './social-kit.mjs'

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
