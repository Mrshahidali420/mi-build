// Sub or dub on anime title pages: read only from the cast's voice credits
// (src/lib/dub.mjs), and the FAQ question it adds (src/lib/answers.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dubOf, dubLabel, dubFaq } from '../src/lib/dub.mjs'
import { titleFaq } from '../src/lib/title-faq.mjs'

const anime = (characters, extra = {}) => ({
  kind: 'anime',
  id: 1,
  title: 'Frieren',
  status: 'FINISHED',
  characters,
  // Staff credits mark a record fetched since English voices were asked for.
  staff: [{ role: 'Director', name: 'Keiichirou Saitou' }],
  ...extra,
})
const jp = (name, voice) => ({ name, role: 'MAIN', voice })
const both = (name, voice, voiceEn) => ({ name, role: 'MAIN', voice, voiceEn })

test('an English voice credit anywhere in the cast means a dub', () => {
  const dub = dubOf(anime([jp('Fern', 'Kana Ichinose'), both('Frieren', 'Atsumi Tanezaki', 'Mallorie Rodak')]))
  assert.equal(dub.state, 'dub')
  assert.deepEqual(dub.english, [{ name: 'Frieren', voice: 'Mallorie Rodak' }])
  assert.equal(dubLabel(dub), 'English dub')
})

test('a Japanese cast with no English credit is subtitled only', () => {
  const dub = dubOf(anime([jp('Fern', 'Kana Ichinose'), jp('Stark', 'Chiaki Kobayashi')]))
  assert.equal(dub.state, 'sub')
  assert.equal(dubLabel(dub), 'Subtitled only — no English dub cast listed')
})

test('an older record, fetched before English voices were asked for, is never called subtitled only', () => {
  const cast = [jp('Fern', 'Kana Ichinose')]
  assert.equal(dubOf(anime(cast, { staff: undefined })), null)
  assert.equal(dubOf(anime(cast, { staff: [] })), null)
  assert.equal(dubFaq(anime(cast, { staff: undefined })), null)
  // An English credit is evidence on its own, old record or not.
  assert.equal(dubOf(anime([both('Fern', 'Kana Ichinose', 'Jill Harris')], { staff: undefined })).state, 'dub')
})

test('no voice credits at all claims nothing either way', () => {
  assert.equal(dubOf(anime([{ name: 'Fern', role: 'MAIN', voice: null }])), null)
  assert.equal(dubOf(anime([])), null)
  assert.equal(dubOf(anime(undefined)), null)
  assert.equal(dubLabel(null), '')
  assert.equal(dubFaq(anime([])), null)
})

test('a comic never gets a sub or dub answer, even with stray voice fields', () => {
  assert.equal(dubOf({ kind: 'manga', title: 'X', characters: [both('A', 'B', 'C')] }), null)
  assert.equal(dubOf(null), null)
})

test('the dub answer names up to three English credits, from the record only', () => {
  const faq = dubFaq(
    anime([
      both('Frieren', 'Atsumi Tanezaki', 'Mallorie Rodak'),
      both('Fern', 'Kana Ichinose', 'Jill Harris'),
      both('Stark', 'Chiaki Kobayashi', 'Jordan Dash Cruz'),
      both('Himmel', 'Nobuhiko Okamoto', 'Chris Niosi'),
    ])
  )
  assert.equal(faq.q, 'Is Frieren dubbed in English?')
  assert.match(faq.a, /^Yes, AniList lists an English dub cast for Frieren: /)
  assert.match(faq.a, /Mallorie Rodak voices Frieren, Jill Harris voices Fern and Jordan Dash Cruz voices Stark\./)
  assert.doesNotMatch(faq.a, /Chris Niosi/)
})

test('the subtitled answer says no English cast is listed, not that none exists', () => {
  const faq = dubFaq(anime([jp('Fern', 'Kana Ichinose')]))
  assert.equal(faq.q, 'Is Frieren dubbed in English?')
  assert.match(faq.a, /^AniList lists no English dub cast for Frieren/)
  assert.doesNotMatch(faq.a, /^Yes/)
})

test('an anime FAQ gains the dub question; a comic FAQ does not', () => {
  const withDub = titleFaq(anime([both('Frieren', 'Atsumi Tanezaki', 'Mallorie Rodak')], { episodes: 28 }), 'anime')
  assert.ok(withDub.some((row) => row.q === 'Is Frieren dubbed in English?'))
  const noCredits = titleFaq(anime([{ name: 'Frieren', role: 'MAIN' }]), 'anime')
  assert.ok(!noCredits.some((row) => /dubbed/.test(row.q)))
  const comic = titleFaq({ kind: 'manga', title: 'Frieren', characters: [both('A', 'B', 'C')] }, 'manga')
  assert.ok(!comic.some((row) => /dubbed/.test(row.q)))
})

test('the dub question never pushes out one of the usual seven', () => {
  const item = anime([both('Frieren', 'Atsumi Tanezaki', 'Mallorie Rodak')], { episodes: 28 })
  const plain = titleFaq({ ...item, characters: [{ name: 'Frieren', role: 'MAIN' }] }, 'anime')
  const dubbed = titleFaq(item, 'anime')
  assert.equal(dubbed.length, plain.length + 1)
})
