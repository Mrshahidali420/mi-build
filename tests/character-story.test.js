import { test } from 'node:test'
import assert from 'node:assert/strict'
import { characterStory, STORY_MAX } from '../src/lib/character-story.mjs'
import { characterProfile, ordinal } from '../src/lib/character-profile.mjs'
import { attachCharacterFacts } from '../src/lib/character-facts.mjs'

const BAD = /undefined|null|NaN|\[object/

test('ordinal', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'])
})

// Four characters in one manga; favourites decide the order.
const row = { kind: 'comic', country: 'JP', slug: 'tale', title: 'Tale', role: 'SUPPORTING' }
const cast = [
  { slug: 'a', name: 'A', favourites: 50, appearsIn: [{ ...row, role: 'MAIN' }] },
  { slug: 'b', name: 'B', favourites: 900, appearsIn: [row] },
  { slug: 'c', name: 'C', favourites: 7, appearsIn: [row] },
  { slug: 'd', name: 'D', favourites: 0, appearsIn: [row] },
]

test('build time: each row gets its cast size and place by favourites', () => {
  const out = attachCharacterFacts(cast, [])
  const place = (slug) => out.find((p) => p.slug === slug).appearsIn[0]
  assert.equal(place('b').favRank, 1)
  assert.equal(place('a').favRank, 2)
  assert.equal(place('c').favRank, 3)
  assert.equal(place('a').castN, 4)
  assert.equal(place('d').favRank, undefined, 'no favourites, no place')
})

test('build time: a stale place is replaced, not kept', () => {
  const stale = cast.map((p) => ({ ...p, appearsIn: p.appearsIn.map((r) => ({ ...r, castN: 99, favRank: 99 })) }))
  const out = attachCharacterFacts(stale, [])
  assert.equal(out.find((p) => p.slug === 'b').appearsIn[0].castN, 4)
  assert.equal(out.find((p) => p.slug === 'd').appearsIn[0].castN, undefined)
})

test('profile: the cast sentence names the place, only for casts of three or more', () => {
  const [c] = attachCharacterFacts(cast, []).filter((p) => p.slug === 'c')
  const { text, keys } = characterProfile(c, { name: 'C', lead: c.appearsIn[0] })
  assert.ok(keys.includes('cast'))
  assert.match(text, /Of the 4 characters in that story with a page here, .* the 3rd most favourited on AniList\./)
  const [top] = attachCharacterFacts(cast, []).filter((p) => p.slug === 'b')
  assert.match(characterProfile(top, { name: 'B', lead: top.appearsIn[0] }).text, /is the most favourited/)
  const pair = attachCharacterFacts(cast.slice(0, 2), [])[0]
  assert.ok(!characterProfile(pair, { name: 'A', lead: pair.appearsIn[0] }).keys.includes('cast'), '2 of 2 says nothing')
})

const manga = (extra = {}) => ({
  kind: 'comic', country: 'JP', slug: 'tale', title: 'Tale', status: 'FINISHED', chapters: 162, volumes: 18,
  startYear: 1994, endYear: 2001, characters: [], relations: [], ...extra,
})

test('story: a finished manga with an anime says both, title named once', () => {
  const text = characterStory(manga({ adapt: { shows: [{ title: 'Tale', format: 'TV', episodes: 74, startYear: 2004, sites: ['Netflix'] }] } }), 'manga')
  assert.match(text, /streams on Netflix/)
  assert.match(text, /162 chapters/)
  assert.equal(text.split('Tale').length - 1, 1, 'the title once, then "it"')
  assert.doesNotMatch(text, BAD)
})

test('story: ongoing, hiatus and cancelled read differently', () => {
  assert.match(characterStory(manga({ status: 'RELEASING', chapters: 45 }), 'manga'), /still running, with 45 chapters/)
  assert.match(characterStory(manga({ status: 'HIATUS', chapters: 40 }), 'manga'), /on hiatus after 40 chapters/)
  assert.match(characterStory(manga({ status: 'CANCELLED', chapters: 12, endYear: 2010 }), 'manga'), /cancelled at chapter 12/)
})

test('story: never more than STORY_MAX sentences, empty with nothing to say', () => {
  const rich = manga({
    status: 'RELEASING', chapters: 400,
    adapt: { shows: [{ title: 'Tale', format: 'TV', episodes: 24, startYear: 2020, sites: ['Crunchyroll'] }] },
    relations: [{ relation: 'SIDE_STORY', title: 'Tale Extra' }, { relation: 'SPIN_OFF', title: 'Tale Gaiden' }],
  })
  const text = characterStory(rich, 'manga')
  assert.ok(text.split(/(?<=\.)\s+/).length <= STORY_MAX)
  assert.equal(characterStory(null, 'manga'), '')
  const web = { title: 'Dawang', status: 'FINISHED', format: 'ONA', episodes: 12, startYear: 2020 }
  assert.match(characterStory(web, 'anime'), /^In Dawang, all 12 episodes aired/, 'a sentence that never names the story says which one')
  assert.equal(characterStory({ title: 'Bare' }, 'manga'), '')
})
