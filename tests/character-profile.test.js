import { test } from 'node:test'
import assert from 'node:assert/strict'
import { characterProfile, profileFacts } from '../src/lib/character-profile.mjs'
import { attachCharacterFacts } from '../src/lib/character-facts.mjs'
import { characterFaq } from '../src/lib/character-faq.mjs'
import { faqJsonld } from '../src/lib/answers.mjs'
import { nearDupRate } from '../scripts/measure-core.mjs'

const row = (extra = {}) => ({ kind: 'comic', country: 'JP', slug: 'story', title: 'Story', role: 'MAIN', popularity: 100, ...extra })
const person = (extra = {}) => ({ id: 1, slug: 'hero', name: 'Hero Name', favourites: 0, appearsIn: [row()], ...extra })
const textOf = (p, opts = {}) => characterProfile(p, { name: p.name, ...opts }).text

test('no voice sentence without a voice field, no year without a year', () => {
  const plain = textOf(person({ appearsIn: [row(), row({ kind: 'anime', slug: 'story-anime', title: 'Story TV' })] }))
  assert.doesNotMatch(plain, /voiced|voices/)
  assert.doesNotMatch(plain, /\b(19|20)\d\d\b/)
  const voiced = textOf(person({ appearsIn: [row({ kind: 'anime', voice: 'Jun Voice', voiceEn: 'Ann Dub', year: 2019 })] }))
  assert.match(voiced, /voiced by Jun Voice in Japanese and by Ann Dub in the English dub/)
  assert.match(voiced, /2019/)
})

test('a one-title character gets the story state once, from the loaded title', () => {
  const p = person({ appearsIn: [row({ role: 'SUPPORTING', year: 2004 })] })
  const series = { status: 'FINISHED', startYear: 2004, endYear: 2007 }
  const text = textOf(p, { series, lead: p.appearsIn[0], links: [{ site: 'VIZ', language: 'English' }] })
  assert.match(text, /^The manga Story, which ran from 2004 to 2007, is the only title AniList lists Hero Name in, as a supporting character\./)
  assert.match(text, /It is in English on VIZ\./)
  assert.equal(text.match(/2004/g).length, 1)
})

test('costars and other roles of the same voice are real internal links', () => {
  const p = person({
    gender: 'Male',
    appearsIn: [row({ kind: 'anime', voice: 'Jun Voice' }), row({ slug: 'two', title: 'Two' })],
    costars: [{ slug: 'pal', name: 'Pal', n: 2 }],
    vaOther: [{ slug: 'other-role', name: 'Other Role' }],
  })
  const { html, text } = characterProfile(p, { name: p.name })
  assert.match(html, /<a href="\/character\/pal">Pal<\/a>/)
  assert.match(html, /Jun Voice also voices <a href="\/character\/other-role">Other Role<\/a>\./)
  // The name once, then the pronoun AniList's gender gives.
  assert.equal(text.match(/Hero Name/g).length, 1)
  assert.match(text, /\bHe /)
})

test('names are escaped in the html', () => {
  const p = person({ costars: [{ slug: 'x', name: '<b>&@', n: 3 }], appearsIn: [row(), row({ slug: 'b', title: 'B' })] })
  const { html, text } = characterProfile(p, { name: p.name })
  assert.match(html, /&lt;b&gt;&amp;&#64;/)
  assert.match(text, /<b>&@/)
})

test('the same record always gives the same paragraph', () => {
  const p = person({ appearsIn: [row({ year: 2001 }), row({ slug: 'b', title: 'B', role: 'SUPPORTING', year: 2005 })], favourites: 500 })
  assert.equal(textOf(p), textOf(structuredClone(p)))
  assert.ok(profileFacts(p).length <= 9)
  assert.ok(characterProfile(p, { name: p.name }).keys.length <= 5)
})

test('different facts read differently: low skeleton near-dup over varied shapes', () => {
  const shapes = [
    person({ appearsIn: [row({ year: 2004, role: 'SUPPORTING' })] }),
    person({ appearsIn: [row({ year: 2001 }), row({ kind: 'anime', slug: 'a', title: 'A', voice: 'V One', year: 2003 })], costars: [{ slug: 'c', name: 'C', n: 2 }] }),
    person({ appearsIn: [row({ kind: 'anime', voice: 'V Two', voiceEn: 'E Two', year: 2010 })], vaOther: [{ slug: 'd', name: 'D' }, { slug: 'e', name: 'E', en: 1 }] }),
    person({ appearsIn: [row({ role: 'SUPPORTING' }), row({ slug: 'b', title: 'B', role: 'BACKGROUND' }), row({ kind: 'novel', slug: 'n', title: 'N', role: 'SUPPORTING' })] }),
    person({ appearsIn: [row({ year: 1999 }), row({ slug: 'b', title: 'B', role: 'SUPPORTING', year: 2015 })], favourites: 12000 }),
  ]
  const texts = shapes.map((p) => ({ text: textOf(p), names: [p.name, ...p.appearsIn.map((a) => a.title)] }))
  assert.ok(nearDupRate(texts) <= 0.25, `near-dup ${nearDupRate(texts)}`)
})

test('attachCharacterFacts: years, costars need two shared titles, voices skip self', () => {
  const t = (slug) => ({ kind: 'comic', country: 'JP', slug, title: slug, role: 'MAIN' })
  const people = [
    { slug: 'a', name: 'A', favourites: 5, appearsIn: [t('x'), t('y'), { ...t('z'), kind: 'anime', voice: 'V' }] },
    { slug: 'b', name: 'B', favourites: 9, appearsIn: [t('x'), t('y')] },
    { slug: 'c', name: 'C', favourites: 1, appearsIn: [t('x')] },
    { slug: 'd', name: 'D', favourites: 50, appearsIn: [{ ...t('q'), kind: 'anime', voice: 'V' }] },
  ]
  const before = JSON.stringify(people)
  const out = attachCharacterFacts(people, [{ kind: 'manga', country: 'JP', slug: 'x', startYear: 2001 }])
  assert.equal(JSON.stringify(people), before, 'inputs are not changed')
  assert.equal(out[0].appearsIn[0].year, 2001)
  assert.deepEqual(out[0].costars, [{ slug: 'b', name: 'B', n: 2 }])
  assert.equal(out[2].costars, undefined)
  assert.deepEqual(out[0].vaOther, [{ slug: 'd', name: 'D' }])
  assert.deepEqual(out[3].vaOther, [{ slug: 'a', name: 'A' }])
  assert.equal(out[1].vaOther, undefined)
})

test('character FAQ: only questions the record answers, no stock lines', () => {
  const p = person({ appearsIn: [row({ role: 'SUPPORTING' })] })
  const faq = characterFaq(p, p.appearsIn[0], 'manga', null)
  const qs = faq.map((x) => x.q)
  assert.ok(!qs.some((q) => /^Who is/.test(q)), 'no bio, no "Who is"')
  assert.ok(!qs.some((q) => /voices|old|tall|birthday|Where can I|main character/.test(q)))
  const all = faq.map((x) => x.a).join(' ')
  assert.doesNotMatch(all, /AniList profile|cast credit|This page is rebuilt|Open the title page|official licence/)
})

test('character FAQ voice answers name the titles, and JSON-LD mirrors the list', () => {
  const p = person({ age: '17', appearsIn: [row({ kind: 'anime', voice: 'Jun Voice', voiceEn: 'Ann Dub', year: 2020 })] })
  const faq = characterFaq(p, p.appearsIn[0], 'anime', { authors: [], links: [] }, 'A bio.', '', 'Jun Voice', [], 'Ann Dub')
  const jp = faq.find((x) => x.q === 'Who voices Hero Name?')
  assert.equal(jp.a, 'Jun Voice voices Hero Name in Japanese of Story (2020).')
  assert.equal(faq.find((x) => /in English\?$/.test(x.q)).a, 'Ann Dub voices Hero Name in the English dub of Story (2020).')
  assert.equal(faq.find((x) => /How old/.test(x.q)).a, 'Hero Name is 17.')
  const ld = faqJsonld(faq)
  assert.equal(ld.mainEntity.length, faq.length)
  ld.mainEntity.forEach((e, i) => assert.equal(e.name, faq[i].q))
})
