import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { thinLike, thinFree, thinCast, noindexSubpages, noindexCharacterBuy, isNoindexed } from '../src/lib/thin-pages.mjs'

const pick = (sites) => ({ kind: 'comic', readLinks: sites.map((site) => ({ site })) })
const face = (extra = {}) => ({ image: 'x', role: 'SUPPORTING', ...extra })

test('like: thin with fewer than two picks you can get', () => {
  assert.equal(thinLike({ similar: [pick(['VIZ']), pick([]), pick([]), pick([])] }), true)
  assert.equal(thinLike({ similar: [pick(['VIZ']), pick(['Tapas']), pick([]), pick([])] }), false)
})

test('free: thin with a single free platform', () => {
  assert.equal(thinFree({ kind: 'comic', readLinks: [{ site: 'WEBTOON' }, { site: 'Manta' }] }), true)
  assert.equal(thinFree({ kind: 'comic', readLinks: [{ site: 'WEBTOON' }, { site: 'Tapas' }] }), false)
})

test('cast: thin only when few voices AND few leads', () => {
  const grid = (n, extra) => Array.from({ length: n }, () => face(extra))
  assert.equal(thinCast({ characters: [...grid(5), face({ role: 'MAIN' })] }), true)
  assert.equal(thinCast({ characters: [...grid(4), face({ role: 'MAIN' }), face({ role: 'MAIN' })] }), false)
  assert.equal(thinCast({ characters: [...grid(3, { voice: 'V' }), ...grid(3)] }), false)
})

// A popular manhwa with every sub-page: one free platform, a bare cast, buy.
const title = () => ({
  kind: 'comic', country: 'KR', slug: 'root', title: 'Root', popularity: 999999, synonyms: ['Root A', 'Root B'],
  readLinks: [{ site: 'WEBTOON' }, { site: 'Manta' }],
  similar: [pick(['VIZ']), pick(['Tapas']), pick([]), pick([])],
  characters: Array.from({ length: 6 }, () => face()),
})

test('noindexSubpages: thin pages that exist, never an allowlisted one', () => {
  const flags = noindexSubpages(title())
  assert.ok(flags.includes('free'))
  assert.ok(flags.includes('characters'))
  assert.ok(!flags.includes('like'), 'two picks with a platform is not thin')
  const kept = noindexSubpages(title(), new Set(['/manhwa/root/free', '/manhwa/root/characters', '/manhwa/root/buy']))
  assert.deepEqual(kept, [])
  assert.deepEqual(noindexSubpages({ kind: 'comic', slug: 'x', characters: [] }), [], 'no page, no flag')
})

test('character buy: noindexed unless Google shows it; only when the page exists', () => {
  const famous = { slug: 'kim', favourites: 99999, image: 'x', appearsIn: [{ kind: 'comic', slug: 's', title: 'S', popularity: 999999 }] }
  assert.equal(noindexCharacterBuy({ slug: 'nobody', appearsIn: [] }), false)
  const flagged = noindexCharacterBuy(famous)
  assert.equal(noindexCharacterBuy(famous, new Set(['/character/kim/buy'])), false)
  assert.equal(typeof flagged, 'boolean')
})

test('the robots meta is emitted only for a flagged page', () => {
  assert.equal(isNoindexed({ noindex: ['buy'] }, 'buy'), true)
  assert.equal(isNoindexed({ noindex: ['buy'] }, 'free'), false)
  assert.equal(isNoindexed({}, 'buy'), false)
  // Base.astro prints the tag behind its noindex prop and nowhere else.
  const base = readFileSync('src/layouts/Base.astro', 'utf8')
  const tags = base.match(/<meta name="robots"[^>]*>/g) || []
  assert.equal(tags.length, 1)
  assert.match(base, /\{noindex && <meta name="robots" content="noindex,follow" \/>\}/)
})
