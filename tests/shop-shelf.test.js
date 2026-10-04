// The shop shelf (src/lib/shop-shelf.js): the trial links, the card names and
// the order and tracking names of every card Shop.astro draws.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trialUrl, trialFor, bookLabel, objectOf, artFor, shelfCards, TRIALS, pickKicker, volumeOf } from '../src/lib/shop-shelf.js'
import { shopLinks, storeFor } from '../src/lib/shop-links.js'
import { BUY_SOURCES } from '../src/lib/beacon-rows.js'

const pickUrl = (asin) => `https://www.amazon.com/dp/${asin}?tag=${storeFor('US').tag}`
const anime = { kind: 'anime', title: 'Some Show', country: 'JP' }
const manhwa = { kind: 'manga', title: 'Some Story', country: 'KR' }

test('the Prime Video trial uses the US store and tag by default', () => {
  assert.equal(trialUrl('prime', 'US'), 'https://www.amazon.com/prime?tag=manhwaindex-20')
  assert.equal(trialUrl('ku', undefined), 'https://www.amazon.com/kindleunlimited?tag=manhwaindex-20')
})

test('a trial link follows the reader to their own store and tag', () => {
  const uk = storeFor('GB')
  assert.equal(trialUrl('ku', 'GB'), `https://${uk.host}/kindleunlimited?tag=${uk.tag}`)
  const de = storeFor('AT')
  assert.equal(trialUrl('prime', 'AT'), `https://${de.host}/prime?tag=${de.tag}`)
})

test('a country with no store of its own falls back to the US link', () => {
  assert.equal(trialUrl('prime', 'PK'), trialUrl('prime', 'US'))
})

test('an unknown trial builds no link', () => {
  assert.equal(trialUrl('music', 'US'), null)
})

test('Prime Video sits beside an anime, Kindle Unlimited beside a comic or a novel', () => {
  assert.equal(trialFor(anime, 'US').kind, 'trial-prime')
  assert.equal(trialFor(manhwa, 'US').kind, 'trial-ku')
  assert.equal(trialFor({ kind: 'novel', country: 'JP' }, 'US').kind, 'trial-ku')
  assert.equal(trialFor(null, 'US'), null)
})

test('the trial words never promise a number of days', () => {
  for (const trial of Object.values(TRIALS)) {
    assert.doesNotMatch(`${trial.label} ${trial.note} ${trial.cta}`, /\d/)
    assert.match(trial.note, /free trial/i)
  }
})

test('the books card is named after what is printed', () => {
  assert.equal(bookLabel(anime), 'The manga')
  assert.equal(bookLabel(manhwa), 'The manhwa')
  assert.equal(bookLabel({ kind: 'manga', country: 'JP' }), 'The manga')
  assert.equal(bookLabel({ kind: 'manga', country: 'CN' }), 'The manhua')
  assert.equal(bookLabel({ kind: 'novel', country: 'JP' }), 'The light novel')
  assert.equal(bookLabel({ kind: 'novel', country: 'KR' }), 'The novel')
  assert.equal(bookLabel(null), 'The books')
})

test('each shop kind gets its own object', () => {
  assert.equal(objectOf('books'), 'book')
  assert.equal(objectOf('discs'), 'case')
  assert.equal(objectOf('prints'), 'frame')
  assert.equal(objectOf('apparel'), 'tee')
  assert.equal(objectOf('merch'), 'stand')
  assert.equal(objectOf('figures'), 'stand')
  assert.equal(objectOf('anything'), 'stand')
})

test('an object falls back to the cover, then to no art at all', () => {
  assert.equal(artFor('stand', { portrait: 'p', cover: 'c' }), 'p')
  assert.equal(artFor('stand', { cover: 'c' }), 'c')
  assert.equal(artFor('screen', { banner: 'b', cover: 'c' }), 'b')
  assert.equal(artFor('book', { portrait: 'p' }), null)
  assert.equal(artFor('book', undefined), null)
})

test('an anime shelf: discs, manga, figures, then the Prime trial, all tracked', () => {
  const buys = shopLinks(anime, 'US')
  const { cards, rest } = shelfCards({ item: anime, buys, trial: trialFor(anime, 'US'), art: { cover: 'c' }, pickUrl })
  assert.deepEqual(
    cards.map((c) => [c.aff, c.src, c.object, c.label]),
    [
      ['discs', 'buybox', 'case', 'Blu-ray & DVD'],
      ['books', 'buybox', 'book', 'The manga'],
      ['merch', 'buybox', 'stand', 'Figures & merch'],
      ['trial-prime', 'trial', 'screen', 'Watch with Prime Video'],
    ],
  )
  assert.equal(rest.length, 0)
  // With no pick, the first card carries the lead weight.
  assert.deepEqual(cards.map((c) => c.lead), [true, false, false, false])
  for (const card of cards) {
    assert.match(card.url, /[?&]tag=manhwaindex-20\b/)
    assert.ok(BUY_SOURCES.has(card.src), `${card.src} is a source the beacon keeps`)
  }
})

test('the real product leads, and the other picks wait under the cards', () => {
  const picks = [
    { a: '1569319006', n: 'Naruto, Vol. 1: Uzumaki Naruto', t: 'book' },
    { a: '1421525828', n: 'Naruto Box Set 1', t: 'book' },
    { a: 'B09PR99KT7', n: 'Naruto figure', t: 'figure' },
  ]
  const buys = shopLinks(manhwa, 'US')
  const { cards, rest } = shelfCards({ item: manhwa, buys, picks, byHand: true, trial: trialFor(manhwa, 'US'), pickUrl })
  assert.equal(cards[0].aff, 'pick_book')
  assert.equal(cards[0].src, 'pick')
  assert.equal(cards[0].url, pickUrl('1569319006'))
  assert.equal(cards[0].lead, true)
  assert.equal(cards[0].tab, 'Vol. 1')
  assert.equal(cards[0].kicker, 'English edition · Vol. 1')
  assert.equal(cards.filter((c) => c.lead).length, 1)
  assert.deepEqual(rest.map((p) => p.a), ['1421525828', 'B09PR99KT7'])
  assert.equal(cards.at(-1).aff, 'trial-ku')
})

test('a box set wears no Vol. 1 tab and says it is a box set', () => {
  const { cards } = shelfCards({ picks: [{ a: '1421525828', n: 'Naruto Box Set 1', t: 'book', type: 'Manga' }], pickUrl })
  assert.equal(cards[0].tab, null)
  assert.equal(cards[0].kicker, 'Manga box set')
})

test('a character page keeps its rows own labels and gets no trial', () => {
  const buys = [
    { kind: 'figures', label: 'Figures', note: 'n', cta: 'Shop figures', url: 'https://www.amazon.com/s?k=a&tag=manhwaindex-20' },
    { kind: 'books', label: 'Attack on Titan books', note: 'n', cta: 'Shop books', url: 'https://www.amazon.com/s?k=b&tag=manhwaindex-20' },
  ]
  const { cards } = shelfCards({ buys, art: { portrait: 'p', cover: 'c' }, pickUrl })
  assert.deepEqual(cards.map((c) => c.label), ['Figures', 'Attack on Titan books'])
  assert.deepEqual(cards.map((c) => c.art), ['p', 'c'])
})

test('nothing to sell draws nothing', () => {
  assert.deepEqual(shelfCards({ pickUrl }), { cards: [], rest: [] })
})

test('a pick label says what the thing is', () => {
  assert.equal(pickKicker({ t: 'book', n: 'That Time I Got Reincarnated as a Slime 1', type: 'Light novel' }), 'Light novel · Vol. 1')
  assert.equal(pickKicker({ t: 'book', n: 'Solo Leveling, Vol. 1 (comic)', type: 'Manhwa' }), 'Manhwa · Vol. 1')
  assert.equal(pickKicker({ t: 'book', n: 'Nano Machine T01', type: 'Manhwa' }), 'Manhwa · Vol. 1')
  assert.equal(pickKicker({ t: 'book', n: 'My Dress-Up Darling 01', type: 'Manga' }), 'Manga · Vol. 1')
  assert.equal(pickKicker({ t: 'book', n: 'Vinland Saga Manga Set, Volumes 1-13', type: 'Manga' }), 'Manga box set')
  assert.equal(pickKicker({ t: 'book', n: 'Some Story, Vol. 2', type: null }), 'English edition · Vol. 2')
  assert.equal(pickKicker({ t: 'book', n: 'NieR:Automata: Long Story Short', type: null }), 'English edition')
  assert.equal(pickKicker({ t: 'disc', n: 'Some Show Season 1 Blu-ray' }), 'Blu-ray')
  assert.equal(pickKicker({ t: 'disc', n: 'Some Show Complete DVD' }), 'DVD')
  assert.equal(pickKicker({ t: 'disc', n: 'Some Show' }), 'Blu-ray / DVD')
  assert.equal(pickKicker({ t: 'figure', n: 'x' }), 'Figure')
})

test('volume numbers come from the name, never a guess', () => {
  assert.equal(volumeOf('Fullmetal Alchemist: Fullmetal Edition, Vol. 1'), 1)
  assert.equal(volumeOf('Le retour du clan Hwasan - Tome 1 (1)'), 1)
  assert.equal(volumeOf('86-EIGHTY-SIX, Vol. 1'), 1)
  assert.equal(volumeOf('Death Note Complete Box Set'), null)
})
