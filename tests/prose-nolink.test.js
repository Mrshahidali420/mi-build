import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pagesFact, alikeFact, alikeWhy } from '../src/lib/prose-nolink.mjs'
import { buildOverview } from '../src/lib/prose.mjs'
import { titleFaq } from '../src/lib/title-faq.mjs'
import { faqJsonld } from '../src/lib/answers.mjs'

const pick = (extra = {}) => ({
  title: 'Horimiya',
  slug: 'horimiya',
  kind: 'manga',
  status: 'FINISHED',
  chapters: 125,
  shared: ['Romance'],
  readLinks: [{ site: 'Yen Press', url: 'https://yenpress.com/x' }],
  ...extra,
})

const noLink = (extra = {}) => ({
  id: 9,
  title: 'Kimi ni Todoke',
  kind: 'manga',
  country: 'JP',
  status: 'RELEASING',
  startYear: 2019,
  genres: ['Romance'],
  readLinks: [],
  otherLinks: [],
  ...extra,
})

test('pagesFact needs an INFO otherLink and names its host and language', () => {
  assert.equal(pagesFact(noLink()), null)
  assert.equal(pagesFact(noLink({ otherLinks: [{ type: 'SOCIAL', url: 'https://x.co.jp/a', site: 'Twitter' }] })), null)
  const f = pagesFact(noLink({ otherLinks: [{ type: 'INFO', url: 'https://comic-days.com/a', site: 'Comic Days', language: 'Japanese' }] }))
  assert.match(f.sentence, /an official Japanese page at comic-days\.com/)
})

test('alikeFact and alikeWhy only use fields the pick holds', () => {
  assert.equal(alikeFact(noLink()), null)
  const item = noLink({ alike: [pick({ tags: ['Love Triangle'] }), pick({ title: 'Other', shared: [], readLinks: [] })] })
  const f = alikeFact(item)
  assert.match(f.sentence, /^The closest licensed read we list is Horimiya, in English on Yen Press: both are romance/)
  // The opening line keeps the two strongest reasons; the list line keeps all.
  assert.doesNotMatch(f.sentence, /125 chapters/)
  const why = alikeWhy(item)
  assert.equal(why.length, 2)
  assert.match(why[0], /complete at 125 chapters/)
  assert.match(why[0], /In English on Yen Press\.$/)
  assert.equal(why[1], 'Complete at 125 chapters.')
})

test('alike reasons never print a blocked tag or genre', () => {
  const item = noLink({ alike: [pick({ shared: ['Ecchi', 'Romance'], tags: ['Harem', 'Boys Love'] })] })
  const text = [alikeFact(item).sentence, ...alikeWhy(item)].join(' ')
  assert.doesNotMatch(text, /ecchi|harem|boys love/i)
})

test('buildOverview carries alikeWhy only when a pick has a reason', () => {
  assert.equal(buildOverview(noLink(), 'manga').alikeWhy, undefined)
  const ov = buildOverview(noLink({ alike: [pick()] }), 'manga')
  assert.equal(ov.alikeWhy.length, 1)
})

test('title FAQ asks only what the record can answer', () => {
  const bare = titleFaq({ title: 'Bare', kind: 'manga', readLinks: [] }, 'manga')
  assert.deepEqual(bare, [])
  const faq = titleFaq(noLink({ chapters: 40, otherLinks: [{ type: 'INFO', url: 'https://comic-days.com/a', language: 'Japanese' }] }), 'manga')
  const qs = faq.map((x) => x.q)
  assert.ok(qs.some((q) => /^Where can I read/.test(q)))
  assert.ok(qs.some((q) => /^Has .* ended\?$/.test(q)))
  assert.ok(qs.some((q) => /^How many chapters/.test(q)))
  assert.ok(!qs.some((q) => /^Is .* on /.test(q)))
  assert.ok(!qs.some((q) => /free to/.test(q)), 'no free question without platforms')
  const where = faq.find((x) => /^Where/.test(x.q)).a
  assert.match(where, /comic-days\.com/)
})

test('a one-chapter title gets no chapter-count question', () => {
  const faq = titleFaq(noLink({ chapters: 1, status: 'FINISHED', endYear: 2020 }), 'manga')
  assert.ok(!faq.some((x) => /How many/.test(x.q)))
})

test('FAQPage JSON-LD mirrors the visible FAQ', () => {
  const faq = titleFaq(noLink({ chapters: 40 }), 'manga')
  const ld = faqJsonld(faq)
  const entities = ld.mainEntity || []
  assert.equal(entities.length, faq.length)
  entities.forEach((e, i) => assert.equal(e.name, faq[i].q))
})
