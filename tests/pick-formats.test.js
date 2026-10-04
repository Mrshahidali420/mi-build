// eBook ISBNs never become a pick (they open Amazon's 404 page), a matched
// pick that names the other form of the story is left off, and a pick says
// what it is only when that can be told honestly (src/lib/picks-core.js,
// scripts/product-picks-core.mjs, data/pick-isbn-formats.json).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { picksForTitleIn, pickType } from '../src/lib/picks-core.js'
import { buildProductPicks } from '../scripts/product-picks-core.mjs'

const json = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'))
const FORMATS = { ebook: ['1975301102'], comic: ['1111111111'], unclear: ['2222222222'] }
const HAND = { titles: {} }
const SLIME_LN = { a: '1975301102', n: 'That Time I Got Reincarnated as a Slime 1', t: 'book' }

test('an eBook ISBN is never shown, and the page falls back to the search card', () => {
  const products = { titles: { 86355: [SLIME_LN], 86399: [SLIME_LN] } }
  assert.equal(picksForTitleIn(HAND, { id: 86355, format: 'NOVEL' }, products, FORMATS), null)
  assert.equal(picksForTitleIn(HAND, { id: 86399, format: 'MANGA' }, products, FORMATS), null)
})

test('an eBook pick is skipped but the rest of the list stays', () => {
  const box = { a: '1975399999', n: 'Slime Box Set', t: 'book' }
  const products = { titles: { 1: [SLIME_LN, box] } }
  assert.deepEqual(picksForTitleIn(HAND, { id: 1, format: 'NOVEL' }, products, FORMATS).picks, [box])
})

test('a matched pick that names the other form of the story is left off', () => {
  const products = {
    titles: {
      1: [{ a: '1638581304', n: 'Classroom of the Elite (Manga) Vol. 1', t: 'book' }],
      2: [{ a: '1975399990', n: 'Some Story, Vol. 1 (Light Novel)', t: 'book' }],
    },
  }
  assert.equal(picksForTitleIn(HAND, { id: 1, format: 'NOVEL', kind: 'novel' }, products, FORMATS), null)
  assert.equal(picksForTitleIn(HAND, { id: 2, format: 'MANGA', kind: 'comic' }, products, FORMATS), null)
  // On an anime page the name only labels it; it is not dropped.
  assert.equal(picksForTitleIn(HAND, { id: 2, kind: 'anime', format: 'TV' }, products, FORMATS).picks.length, 1)
})

test('the build skips eBook records too', () => {
  const rec = (asin, type = 'volume') => ({
    title_id: 5,
    site: 'both',
    product_type: type,
    name: `Story, Vol. 1 ${asin}`,
    volume_number: 1,
    amazon_asin: asin,
    confidence: 'high',
  })
  const { titles } = buildProductPicks({
    records: [rec('1975301102'), rec('1421580365')],
    checkedIds: [5],
    sites: ['both'],
    ebooks: ['1975301102'],
  })
  assert.deepEqual(titles['5'].map((p) => p.a), ['1421580365'])
})

test('a pick is named from its record: novel, manga, manhwa, manhua', () => {
  const book = { a: '1421580365', n: 'Some Story, Vol. 1', t: 'book' }
  assert.equal(pickType(book, { format: 'NOVEL', country: 'JP' }, FORMATS), 'Light novel')
  assert.equal(pickType(book, { format: 'NOVEL', country: 'CN' }, FORMATS), 'Novel')
  assert.equal(pickType(book, { format: 'MANGA', country: 'JP' }, FORMATS), 'Manga')
  assert.equal(pickType(book, { format: 'MANGA', country: 'KR' }, FORMATS), 'Manhwa')
  assert.equal(pickType(book, { kind: 'comic', format: 'MANGA', country: 'CN' }, FORMATS), 'Manhua')
  assert.equal(pickType({ ...book, t: 'disc' }, { format: 'MANGA' }, FORMATS), null)
})

test('an anime page names a pick by its one kind of original, else stays plain', () => {
  const book = { a: '1421580365', n: 'Some Story, Vol. 1', t: 'book' }
  const anime = { kind: 'anime', format: 'TV', country: 'JP' }
  assert.equal(pickType(book, { ...anime, comicInIndex: [{ kind: 'novel', country: 'JP' }] }, FORMATS), 'Light novel')
  assert.equal(pickType(book, { ...anime, comicInIndex: [{ kind: 'comic', country: 'KR' }] }, FORMATS), 'Manhwa')
  const both = { ...anime, comicInIndex: [{ kind: 'novel' }, { kind: 'comic' }] }
  assert.equal(pickType(book, both, FORMATS), null)
  assert.equal(pickType({ ...book, n: 'Some Story, Vol. 1 (Light Novel)' }, both, FORMATS), 'Light novel')
  // No original in the index: the anime's own source says what it was.
  assert.equal(pickType(book, { ...anime, source: 'MANGA' }, FORMATS), 'Manga')
  assert.equal(pickType(book, { ...anime, source: 'LIGHT_NOVEL' }, FORMATS), 'Light novel')
  assert.equal(pickType(book, { ...anime, source: 'ORIGINAL' }, FORMATS), null)
  assert.equal(pickType(book, both, FORMATS), null)
})

test('when the name, Open Library and the record disagree, the label stays plain', () => {
  const comicIsbn = { a: '1111111111', n: 'Some Story, Vol. 1', t: 'book' }
  assert.equal(pickType(comicIsbn, { format: 'NOVEL', country: 'JP' }, FORMATS), null)
  assert.equal(pickType(comicIsbn, { format: 'MANGA', country: 'JP' }, FORMATS), 'Manga')
  assert.equal(pickType({ a: '2222222222', n: 'Shared, Vol. 1', t: 'book' }, { format: 'NOVEL', country: 'JP' }, FORMATS), null)
  assert.equal(pickType({ a: '1421580365', n: 'Story (Manga) Vol. 1', t: 'book' }, { format: 'NOVEL' }, FORMATS), null)
})

test('the shipped data: the Slime eBook ISBN is listed and no longer matched to either Slime record', () => {
  const formats = json('pick-isbn-formats.json')
  const products = json('product-picks.json')
  assert.ok(formats.ebook.includes('1975301102'))
  for (const id of [86355, 86399]) {
    const picks = picksForTitleIn(json('picks.json'), { id, format: id === 86355 ? 'NOVEL' : 'MANGA' }, products, formats)
    assert.ok(!picks || picks.picks.every((p) => p.a !== '1975301102'), `${id} still shows the eBook`)
  }
  const ebook = new Set(formats.ebook)
  for (const list of Object.values(products.titles)) for (const p of list) assert.ok(!ebook.has(p.a), `${p.a} is an eBook`)
})
