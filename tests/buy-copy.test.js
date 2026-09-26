import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleBuyCopy, characterBuyCopy, SUPPORT_LINE } from '../src/lib/buy-copy.js'

const english = [{ site: 'Tapas', language: 'English' }]
const korean = [{ site: 'KakaoPage', language: 'Korean' }]
const comic = (extra) => ({ kind: 'manhwa', title: 'Test Story', readLinks: english, ...extra })

test('the support line names the site and is not the Associates sentence', () => {
  assert.match(SUPPORT_LINE, /manhwaindex/)
  assert.doesNotMatch(SUPPORT_LINE, /Associate|qualifying purchases/)
})

test('a finished licensed comic with a volume count says it is the original run', () => {
  const copy = titleBuyCopy(comic({ status: 'FINISHED', volumes: 12 }))
  assert.equal(copy.heading, 'Collect Test Story in print')
  assert.match(copy.sub, /whole set/)
  assert.match(copy.sub, /original run is complete at 12 volumes/)
})

test('a finished licensed comic with no volume count never prints a number', () => {
  const copy = titleBuyCopy(comic({ status: 'FINISHED', volumes: null }))
  assert.doesNotMatch(copy.sub, /\d/)
})

test('a releasing licensed comic is about keeping up', () => {
  const copy = titleBuyCopy(comic({ status: 'RELEASING' }))
  assert.equal(copy.heading, 'Keep up with Test Story in print')
  assert.doesNotMatch(copy.sub, /volumes so far/)
})

test('a licensed comic with no English print only promises merch', () => {
  const copy = titleBuyCopy(comic({ status: 'FINISHED', volumes: 5 }), { books: false })
  assert.equal(copy.heading, 'Own a piece of Test Story')
  assert.doesNotMatch(copy.sub, /volumes/)
})

test('an unlicensed comic says plainly there is no English edition', () => {
  const copy = titleBuyCopy(comic({ readLinks: korean, status: 'RELEASING' }))
  assert.equal(copy.heading, 'Want Test Story on your shelf?')
  assert.match(copy.sub, /no official English edition/)
  assert.match(copy.sub, /merch/)
})

test('an unlicensed comic with no print found does not promise volumes', () => {
  const copy = titleBuyCopy(comic({ readLinks: [] }), { books: false })
  assert.match(copy.sub, /no official English edition/)
  assert.match(copy.sub, /found no print/)
})

test('a picked book counts as an English print even with no English platform', () => {
  const copy = titleBuyCopy(comic({ readLinks: korean, status: 'FINISHED' }), { books: false, printKnown: true })
  assert.equal(copy.heading, 'Collect Test Story in print')
})

test('an anime is about discs without a subscription', () => {
  const copy = titleBuyCopy({ kind: 'anime', title: 'Show', status: 'FINISHED' })
  assert.equal(copy.heading, 'Keep Show on your shelf')
  assert.match(copy.sub, /no subscription/)
  assert.match(copy.sub, /manga it came from/)
})

test('an airing anime says discs may lag, and drops the manga when that row is gone', () => {
  const copy = titleBuyCopy({ kind: 'anime', title: 'Show', status: 'RELEASING' }, { books: false })
  assert.match(copy.sub, /still airing/)
  assert.doesNotMatch(copy.sub, /manga/)
})

test('character copy names the character and the story', () => {
  const first = characterBuyCopy({ name: 'Jinwoo', story: 'Solo Leveling', merchFirst: true, merchIsCharacter: true })
  assert.equal(first.heading, 'Own a piece of Jinwoo')
  assert.match(first.sub, /of Jinwoo from Solo Leveling/)
  const second = characterBuyCopy({ name: 'Jinwoo', story: 'Solo Leveling', merchFirst: false, merchIsCharacter: true })
  assert.equal(second.heading, 'Books and merch of Jinwoo')
  const crowd = characterBuyCopy({ name: 'Extra', story: 'Solo Leveling', merchFirst: false, merchIsCharacter: false })
  assert.equal(crowd.heading, 'Own the story Extra is from')
  assert.match(crowd.sub, /Solo Leveling merch/)
})

test('no copy carries an em dash', () => {
  const all = [
    SUPPORT_LINE,
    ...['FINISHED', 'RELEASING', 'HIATUS', 'NOT_YET_RELEASED'].flatMap((status) =>
      [english, korean].flatMap((readLinks) =>
        [true, false].flatMap((books) => {
          const a = titleBuyCopy(comic({ status, readLinks, volumes: 3 }), { books })
          const b = titleBuyCopy({ kind: 'anime', title: 'Show', status }, { books })
          return [a.heading, a.sub, b.heading, b.sub]
        })
      )
    ),
  ]
  const emDash = String.fromCharCode(0x2014)
  for (const line of all) assert.ok(!line.includes(emDash), line)
})
