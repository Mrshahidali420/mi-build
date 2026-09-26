// "Read something like it, legally, now". See src/lib/alike.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alikeFor, licensedPools, handoffRate, japaneseLinks, needsAlike, hasEnglishRead,
  ALIKE_MAX, ALIKE_MIN, HANDOFF_MIN_OPENS,
} from '../src/lib/alike.mjs'

const EN = [{ site: 'WEBTOON', url: 'https://w', language: 'English' }]
const KO = [{ site: 'KakaoPage', url: 'https://k', language: 'Korean' }]

const rec = (id, over = {}) => ({
  id, kind: 'comic', country: 'KR', slug: `t-${id}`, title: `Title ${id}`, cover: `c${id}.jpg`,
  genres: ['Romance', 'Fantasy'], tags: [], popularity: 1000 * id, readLinks: EN, ...over,
})

const target = rec(999, { readLinks: [], genres: ['Romance', 'Fantasy', 'Drama'], tags: ['Royalty', 'Omegaverse'] })

test('only a comic or novel with no English platform needs the block', () => {
  assert.equal(needsAlike(target), true)
  assert.equal(needsAlike(rec(1, { readLinks: KO })), true)
  assert.equal(needsAlike(rec(1)), false)
  assert.equal(needsAlike(rec(1, { kind: 'anime', readLinks: [] })), false)
  assert.equal(hasEnglishRead(rec(1, { readLinks: KO })), false)
  // A link with no language might be English: never claim it is not.
  assert.equal(needsAlike(rec(1, { readLinks: [{ site: 'WEBTOON', language: null }] })), false)
})

test('picks are licensed, share two genres, and there are four to six', () => {
  const titles = [target, ...Array.from({ length: 10 }, (_, i) => rec(i + 1))]
  titles.push(rec(50, { readLinks: [] })) // unlicensed: never a pick
  titles.push(rec(51, { genres: ['Romance', 'Horror'] })) // one genre only
  titles.push(rec(52, { kind: 'anime', watchLinks: EN })) // not a read
  const picks = alikeFor(target, licensedPools(titles))
  assert.equal(picks.length, ALIKE_MAX)
  for (const p of picks) {
    assert.ok(![50, 51, 52, 999].includes(p.id))
    assert.ok(p.shared.length >= 2)
  }
})

test('fewer than four matches drops the block', () => {
  const titles = [target, ...Array.from({ length: ALIKE_MIN - 1 }, (_, i) => rec(i + 1))]
  assert.deepEqual(alikeFor(target, licensedPools(titles)), [])
})

test('a licensed page gets no block', () => {
  const titles = Array.from({ length: 8 }, (_, i) => rec(i + 1))
  assert.deepEqual(alikeFor(titles[0], licensedPools(titles)), [])
})

test('without hand-off data the order is match, then popularity', () => {
  const titles = [target, ...Array.from({ length: 8 }, (_, i) => rec(i + 1))]
  titles.push(rec(20, { popularity: 1, tags: ['Royalty', 'Omegaverse'] }))
  const picks = alikeFor(target, licensedPools(titles))
  assert.equal(picks[0].id, 20) // two shared tags beat any popularity
  assert.equal(picks[1].id, 8) // then the most popular
})

test('a known hand-off rate reorders the short list', () => {
  const titles = [target, ...Array.from({ length: 8 }, (_, i) => rec(i + 1))]
  const handoff = { pages: { 2: [100, 40], 3: [HANDOFF_MIN_OPENS - 1, 29] } }
  const picks = alikeFor(target, licensedPools(titles), { handoff })
  assert.equal(picks[0].id, 2) // 40 in 100 readers left through it
  assert.notEqual(picks[1].id, 3) // too few opens to trust
})

test('handoffRate ignores thin and malformed rows', () => {
  assert.equal(handoffRate(null, 1), null)
  assert.equal(handoffRate({ pages: { 1: [10, 5] } }, 1), null)
  assert.equal(handoffRate({ pages: { 1: 'x' } }, 1), null)
  assert.equal(handoffRate({ pages: { 1: [50, 10] } }, 1), 0.2)
  assert.equal(handoffRate({ pages: { 1: [50, 90] } }, 1), 1)
})

test('the same input gives the same picks', () => {
  const titles = [target, ...Array.from({ length: 9 }, (_, i) => rec(i + 1, { popularity: 5 }))]
  const a = alikeFor(target, licensedPools(titles)).map((p) => p.id)
  const b = alikeFor(target, licensedPools([...titles].reverse())).map((p) => p.id)
  assert.deepEqual(a, b)
})

test('Japanese links: INFO only, .jp or marked Japanese, never shops or social', () => {
  const item = {
    ...target,
    otherLinks: [
      { site: 'Official Site', url: 'https://www.to-corona-ex.jp/x', type: 'INFO' },
      { site: 'Comic App', url: 'https://app.example.com/t', type: 'INFO', language: 'Japanese' },
      { site: 'Twitter', url: 'https://twitter.jp/x', type: 'SOCIAL' },
      { site: 'Amazon', url: 'https://www.amazon.co.jp/dp/1', type: 'INFO' },
      { site: 'Kodansha USA', url: 'https://kodansha.us/x', type: 'INFO' },
      { site: 'Dup', url: 'https://to-corona-ex.jp/y', type: 'INFO' },
    ],
  }
  const links = japaneseLinks(item)
  assert.deepEqual(links.map((l) => l.host), ['to-corona-ex.jp', 'app.example.com'])
  assert.deepEqual(japaneseLinks({ ...item, readLinks: EN }), [])
})
