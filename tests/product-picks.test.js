// Product picks matched from publisher records (scripts/product-picks-core.mjs),
// how they fall in behind the hand picks (src/lib/picks-core.js), and the
// "Shop books" row that goes away for a title with no English print
// (src/lib/shop-links.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { buildProductPicks, validAsin, cleanName, MAX_PICKS } from '../scripts/product-picks-core.mjs'
import { picksForTitleIn, booksKnownIn, PICK_LABELS } from '../src/lib/picks-core.js'
import { shopLinks } from '../src/lib/shop-links.js'

const rec = (over) => ({
  title_id: 1,
  site: 'both',
  product_type: 'volume',
  name: 'Some Story, Vol. 1',
  volume_number: 1,
  amazon_asin: '1421580365',
  confidence: 'high',
  ...over,
})

const RECORDS = [
  rec({ title_id: 1, volume_number: 2, name: 'Some Story  Vol. 2 ', amazon_asin: '1421580373' }),
  rec({ title_id: 1, volume_number: 1, confidence: 'medium', amazon_asin: '1612620248' }),
  rec({ title_id: 1, volume_number: 1, name: '  Some Story,\n Vol. 1 ' }),
  rec({ title_id: 1, product_type: 'box-set', name: 'Some Story Box Set', amazon_asin: '1974700569' }),
  rec({ title_id: 1, product_type: 'dvd', name: 'Some Story DVD', amazon_asin: 'B000ABCDEF' }),
  rec({ title_id: 1, product_type: 'blu-ray', name: 'Some Story Blu-ray', amazon_asin: 'B01ABCDEFG' }),
  // A bad check digit, a lowercase junk ASIN and no ASIN: none may become a pick.
  rec({ title_id: 2, amazon_asin: '1421580366' }),
  rec({ title_id: 2, amazon_asin: 'abc' }),
  rec({ title_id: 3, amazon_asin: null }),
  rec({ title_id: 9, site: 'other' }),
  rec({ title_id: 5 }),
]

const build = () =>
  buildProductPicks({
    records: RECORDS,
    checkedIds: [1, 2, 3, 4, 5],
    handTitles: { 5: [{ a: 'B0HANDPICK', n: 'Hand', t: 'figure' }] },
    sites: ['both'],
  })

test('ASINs are checked, ISBN-10 check digit included', () => {
  assert.equal(validAsin('1421580365'), true)
  assert.equal(validAsin('1421580366'), false)
  assert.equal(validAsin('B01ABCDEFG'), true)
  assert.equal(validAsin('B01ABC'), false)
  assert.equal(validAsin(null), false)
})

test('names are one clean line, cut at a word when long', () => {
  assert.equal(cleanName('  A\n  b  '), 'A b')
  const long = cleanName('word '.repeat(40))
  assert.ok(long.length <= 71 && long.endsWith('…'))
})

test('each title gets volume 1, one box set and one disc, as {a,n,t} only', () => {
  const { titles } = build()
  const picks = titles['1']
  assert.ok(picks.length <= MAX_PICKS)
  assert.deepEqual(picks, [
    { a: '1421580365', n: 'Some Story, Vol. 1', t: 'book' },
    { a: '1974700569', n: 'Some Story Box Set', t: 'book' },
    { a: 'B01ABCDEFG', n: 'Some Story Blu-ray', t: 'disc' },
  ])
  for (const list of Object.values(titles)) {
    for (const pick of list) {
      assert.deepEqual(Object.keys(pick).sort(), ['a', 'n', 't'])
      assert.ok(validAsin(pick.a), pick.a)
      assert.ok(PICK_LABELS[pick.t], pick.t)
    }
  }
})

test('a volume number written only in the name still counts', () => {
  const { titles } = buildProductPicks({
    records: [
      rec({ title_id: 6, volume_number: 2, name: 'Other, Vol. 2', amazon_asin: '1421580373' }),
      rec({ title_id: 6, volume_number: null, name: 'Other', amazon_asin: '1974700569', confidence: 'medium' }),
      rec({ title_id: 6, volume_number: null, name: 'Other 1', amazon_asin: '1612620248', confidence: 'medium' }),
    ],
    checkedIds: [6],
    sites: ['both'],
  })
  assert.equal(titles['6'][0].n, 'Other 1')
})

test('bad ASINs, other sites and hand-picked titles get no product picks', () => {
  const { titles } = build()
  assert.equal(titles['2'], undefined)
  assert.equal(titles['3'], undefined)
  assert.equal(titles['9'], undefined)
  assert.equal(titles['5'], undefined, 'the hand picks win')
})

test('checked titles with no book records are listed; books without an ASIN are not', () => {
  const { noEnglishBooks } = build()
  assert.deepEqual(noEnglishBooks, [4])
})

test('the file on disk, when present, keeps the same shape and carries no tag', () => {
  const file = new URL('../data/product-picks.json', import.meta.url)
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  assert.doesNotMatch(text, /tag=|"[a-z0-9]+-2[0-2]"/i)
  const data = JSON.parse(text)
  const hand = JSON.parse(readFileSync(new URL('../data/picks.json', import.meta.url), 'utf8'))
  for (const [id, list] of Object.entries(data.titles)) {
    assert.equal(hand.titles[id], undefined, `${id} is hand-picked`)
    assert.ok(list.length >= 1 && list.length <= MAX_PICKS, id)
    for (const pick of list) {
      assert.deepEqual(Object.keys(pick).sort(), ['a', 'n', 't'], id)
      assert.ok(validAsin(pick.a), `${id}: ${pick.a}`)
    }
  }
  assert.ok(Array.isArray(data.noEnglishBooks))
})

// ---------------------------------------------------------------- the pages

const HAND = { titles: { 10: [{ a: 'B0FIGURE01', n: 'Figure', t: 'figure' }] } }
const PRODUCTS = {
  titles: {
    10: [{ a: '1421580365', n: 'Ignored', t: 'book' }],
    20: [{ a: '1421580365', n: 'Manga Vol. 1', t: 'book' }],
    30: [{ a: 'B01ABCDEFG', n: 'Disc only', t: 'disc' }],
  },
  noEnglishBooks: [30, 40, 50],
}

test('hand picks win, product picks fill in, and say they were not chosen by hand', () => {
  assert.deepEqual(picksForTitleIn(HAND, { id: 10 }, PRODUCTS), { picks: HAND.titles[10], byHand: true, from: null, owner: { id: 10 } })
  assert.deepEqual(picksForTitleIn(HAND, { id: 20 }, PRODUCTS), { picks: PRODUCTS.titles[20], byHand: false, from: null, owner: { id: 20 } })
  const anime = { id: 21, relations: [{ id: 20, relation: 'SOURCE', title: 'The Manga' }] }
  assert.equal(picksForTitleIn(HAND, anime, PRODUCTS).from, 'The Manga')
  assert.equal(picksForTitleIn(HAND, { id: 99 }, PRODUCTS), null)
  // The manga of a hand-picked anime keeps the anime's hand picks, as before.
  const manga = { id: 20, relations: [{ id: 10, relation: 'ADAPTATION', title: 'The Anime' }] }
  assert.deepEqual(picksForTitleIn(HAND, manga, PRODUCTS), {
    picks: HAND.titles[10],
    byHand: true,
    from: 'The Anime',
    owner: manga.relations[0],
  })
})

const kinds = (item) => shopLinks(item, 'US', { books: booksKnownIn(HAND, item, PRODUCTS) }).map((r) => r.kind)

test('a checked title with no English books loses the books row, keeps merch', () => {
  assert.deepEqual(kinds({ id: 40, kind: 'manga', title: 'Kirawaremono no Ore wa' }), ['merch'])
  // A disc is not a book.
  assert.deepEqual(kinds({ id: 30, kind: 'manga', title: 'Disc Story' }), ['merch'])
})

test('a title with book picks keeps the books row', () => {
  assert.deepEqual(kinds({ id: 20, kind: 'manga', title: 'Known Story' }), ['books', 'merch'])
})

test('a title that was never checked keeps the books row', () => {
  assert.deepEqual(kinds({ id: 777, kind: 'manga', title: 'Unchecked Story' }), ['books', 'merch'])
})

test("an anime row follows its source manga's picks", () => {
  const anime = (relation) => ({ id: 50, kind: 'anime', title: 'The Show', relations: [{ id: 20, relation }] })
  assert.deepEqual(kinds(anime('SOURCE')), ['discs', 'books', 'merch'])
  // Checked empty, and the only relation is not the same story: no books row.
  assert.deepEqual(kinds(anime('CHARACTER')), ['discs', 'merch'])
})

test('shopLinks keeps its old rows when no books flag is passed', () => {
  assert.deepEqual(shopLinks({ kind: 'manga', title: 'Anything' }, 'US').map((r) => r.kind), ['books', 'merch'])
})
