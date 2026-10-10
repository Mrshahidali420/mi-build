import { test } from 'node:test'
import assert from 'node:assert/strict'
import { castContext, withCastFacts } from '../src/lib/cast-facts.mjs'
import { leadLine, castSummary, plainOf } from '../src/lib/cast-page.mjs'
import { likeExtras, byLikeRank, recSetOf } from '../src/lib/like-facts.mjs'
import { likeAnswer } from '../src/lib/like-answer.mjs'
import { freeAnswer, freeLine } from '../src/lib/free-answer.mjs'
import { titleSummary } from '../src/lib/title-summary.mjs'
import { factsFor } from '../src/lib/platform-facts.js'

/* ------------------------------------------------------------ /characters */

const face = (slug, role = 'SUPPORTING', extra = {}) => ({ slug, name: slug.toUpperCase(), image: 'x.png', role, ...extra })
const castTitle = (extra = {}) => ({
  kind: 'anime',
  slug: 'show',
  title: 'Show',
  characters: [face('lead', 'MAIN', { voice: 'Jun', voiceEn: 'Ann' }), face('b'), face('c'), face('d'), face('e'), face('f')],
  chain: [{ slug: 'show', kind: 'anime', title: 'Show', self: true }, { slug: 'show-2', kind: 'anime', title: 'Show 2' }],
  ...extra,
})
const people = [
  { slug: 'lead', name: 'Lead', favourites: 50, appearsIn: [{ kind: 'anime', slug: 'show', title: 'Show' }, { kind: 'anime', slug: 'show-2', title: 'Show 2', popularity: 9 }, { kind: 'manga', slug: 'book', title: 'Book', popularity: 3 }], vaOther: [{ slug: 'other', name: 'Other' }] },
  { slug: 'b', name: 'B', favourites: 900, appearsIn: [{ kind: 'anime', slug: 'show', title: 'Show' }, { kind: 'anime', slug: 'show-2', title: 'Show 2' }] },
  { slug: 'c', name: 'C', favourites: 1, appearsIn: [{ kind: 'anime', slug: 'show', title: 'Show' }] },
]

test('withCastFacts: lead facts, top face and shared cast, input untouched', () => {
  const item = castTitle()
  const before = JSON.stringify(item)
  const out = withCastFacts(item, castContext(people))
  assert.equal(JSON.stringify(item), before)
  const lead = out.characters.find((c) => c.slug === 'lead')
  assert.deepEqual(lead.more, { n: 2, top: 'Show 2' })
  assert.deepEqual(lead.va, { slug: 'other', name: 'Other' })
  assert.equal(out.characters.find((c) => c.slug === 'b').more, undefined, 'only leads get a line')
  assert.deepEqual(out.castFacts.top, { slug: 'b', name: 'B', favourites: 900 })
  assert.deepEqual(out.castFacts.shared, [{ slug: 'show-2', kind: 'anime', title: 'Show 2', n: 2 }])
  // Under six faces there is no cast page, so nothing is added.
  const small = castTitle({ characters: castTitle().characters.slice(0, 3) })
  assert.equal(withCastFacts(small, castContext(people)), small)
})

test('cast page lines say only what the record holds', () => {
  const out = withCastFacts(castTitle(), castContext(people))
  const lead = out.characters.find((c) => c.slug === 'lead')
  const line = plainOf(leadLine(lead, { anime: true }))
  assert.equal(line, 'LEAD: voiced by Jun in Japanese and Ann in English; in 2 other titles too, the best known Show 2. Jun also voices Other.')
  assert.doesNotMatch(plainOf(leadLine(lead, { anime: false })), /voice/)
  assert.equal(leadLine(face('x', 'MAIN')), '', 'nothing held, no line')
  const summary = plainOf(castSummary(out, out.characters, { anime: true }))
  assert.match(summary, /^6 named characters, 1 of them a lead\. 1 with a Japanese voice and 1 with an English one\. 2 of them also appear in Show 2\. The most favourited face is B, on 900 AniList favourites lists\.$/)
  assert.doesNotMatch(summary, /Tap any face/)
})

/* ------------------------------------------------------------------ /like */

test('likeExtras: safe shared tags, real creators and studios, readers suggestions', () => {
  const item = { id: 1, kind: 'comic', tags: ['Revenge', 'Harem', 'Time Skip'], authors: [{ name: 'Ann', role: 'Story' }, { name: 'Lee', role: 'Lettering (English)' }], recIds: [{ id: 2 }] }
  const pick = { id: 2, kind: 'comic', tags: ['Harem', 'Revenge', 'Time Skip'], authors: [{ name: 'Lee', role: 'Story' }], chapters: 80, startYear: 2015 }
  assert.deepEqual(likeExtras(item, pick, recSetOf(item)), { tags: ['Revenge', 'Time Skip'], count: 80, year: 2015, inRecs: true })
  const same = { ...pick, authors: [{ name: 'Ann', role: 'Story & Art' }] }
  assert.equal(likeExtras(item, same).author, 'Ann')
  const anime = likeExtras({ kind: 'anime', studios: ['MAPPA'] }, { kind: 'anime', studios: ['MAPPA'], episodes: 12 })
  assert.deepEqual(anime, { studio: 'MAPPA', count: 12 })
  const ranked = [[{ id: 3, popularity: 9 }, ['a', 'b', 'c']], [{ id: 2, popularity: 1 }, ['a', 'b']]].sort(byLikeRank(new Set([2])))
  assert.equal(ranked[0][0].id, 2, 'a readers suggestion ranks first')
})

const likeItem = () => ({
  title: 'Root', kind: 'comic', status: 'RELEASING', chapters: 100, startYear: 2016,
  similar: [
    { slug: 'a', title: 'A', kind: 'comic', status: 'FINISHED', shared: ['Action', 'Drama'], count: 300, year: 2005, readLinks: [{ site: 'VIZ' }], inRecs: true },
    { slug: 'b', title: 'B', kind: 'comic', status: 'RELEASING', shared: ['Action', 'Fantasy'], tags: ['Revenge'], count: 40, year: 2019, readLinks: [] },
    { slug: 'c', title: 'C', kind: 'comic', status: 'FINISHED', shared: ['Drama', 'Romance'], author: 'Ann', count: 110, year: 2010, readLinks: [{ site: 'Tapas' }] },
    { slug: 'd', title: 'D', kind: 'comic', status: 'FINISHED', shared: ['Action', 'Drama'], year: 2016, readLinks: [] },
  ],
})

test('like page: a fact lede, no shared paragraphs, one contrasting reason per pick', () => {
  const answer = likeAnswer(likeItem(), 'manga')
  assert.deepEqual(answer.paragraphs, [])
  assert.equal(answer.picks[0].slug, 'a', 'readers suggestion first')
  assert.match(answer.lede, /^4 manga share at least two genres with Root\. AniList readers suggest 1 of them after it too\. One shares its creator, Ann\. 3 have finished, the longest at 300 chapters; 1 is still coming out\. 2 have an official place to read them that we list\.$/)
  assert.doesNotMatch(answer.lede + answer.picks.map((p) => p.reason).join(' '), /hand-written|rebuilt every day|How these were picked/)
  const reasons = answer.picks.map((p) => p.reason)
  assert.equal(reasons[0], 'Shares action and drama; AniList readers suggest it next; longer, at 300 chapters to 100; 11 years older, from 2005')
  assert.match(reasons.find((r) => r.startsWith('Also by Ann')), /a similar length, 110 chapters/)
  let pairs = 0
  let differ = 0
  for (let i = 0; i < reasons.length; i++) for (let j = i + 1; j < reasons.length; j++) { pairs++; if (reasons[i] !== reasons[j]) differ++ }
  assert.ok(differ / pairs >= 0.8)
  reasons.forEach((r) => assert.doesNotMatch(r, /Root/), 'the title is not repeated in every reason')
})

/* ------------------------------------------------------------------ /free */

test('free lines are measured against the title count, with region and account facts', () => {
  const unit = 'chapters'
  const webtoon = { link: { site: 'WEBTOON' }, facts: factsFor('WEBTOON') }
  assert.equal(freeLine(webtoon, unit, 120), 'WEBTOON keeps all but the newest of its 120 chapters free, with no account needed.')
  const naver = { link: { site: 'Naver Series' }, facts: factsFor('Naver Series') }
  assert.equal(freeLine(naver, unit, 0), 'Naver Series gives the first chapters free, in Korea only, after you sign in.')
  assert.equal(freeLine(naver, unit, 50), 'Naver Series gives the first chapters of 50 free, in Korea only, after you sign in.')
})

test('free page: no shared licence paragraph, only facts from the record', () => {
  const item = { title: 'Root', kind: 'comic', chapters: 60, readLinks: [{ site: 'WEBTOON' }, { site: 'Manta' }] }
  const answer = freeAnswer(item, 'manhwa')
  assert.equal(answer.lede, 'Yes, you can read Root for free, and legally, on WEBTOON.')
  const text = answer.paragraphs.map((p) => p.text).join(' ')
  assert.doesNotMatch(text, /scan site|Why every link|take no cut|rebuilt/)
  assert.match(text, /WEBTOON keeps all but the newest of its 60 chapters free/)
  assert.match(text, /Manta needs a monthly plan./)
  assert.ok(answer.paragraphs.every((p) => p.heading !== 'Why every link here is an official one'))
})

test('title summary: two gated lines', () => {
  const item = { title: 'Root', kind: 'comic', status: 'FINISHED', startYear: 2015, endYear: 2019, chapters: 88, authors: [{ name: 'Ann' }], genres: ['Drama', 'Ecchi'], characters: [{ name: 'Kim', role: 'MAIN', image: 'x' }] }
  assert.deepEqual(titleSummary(item, 'manhwa'), ['Root is a manhwa by Ann, first out in 2015, finished in 2019, at 88 chapters.', 'It is drama, led by Kim.'])
  assert.deepEqual(titleSummary({ title: 'Bare', kind: 'comic' }, 'manga'), ['Bare is a manga.'])
})
