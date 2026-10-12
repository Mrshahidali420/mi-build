// The character birthday card (birthdays.mjs, types/birthday-card.mjs): one
// AniList question a day, kept in the ledger; only characters whose work has
// a page here; never on the wrong day; failing soft; the words and the image.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { birthdaysOf, isFresh, loadBirthdays, withBirthdays, MAX_PER_DAY, MIN_FAVOURITES, RETRY_MS } from '../scripts/social/birthdays.mjs'
import { memoryStore } from '../scripts/social/ledger.mjs'
import { captionFor } from '../scripts/social/plan.mjs'
import { kitOf } from '../scripts/social/render/parts.mjs'
import birthday from '../scripts/social/types/birthday.mjs'
import { GAP_DAYS } from '../scripts/social/types/birthday-card.mjs'
import { NOW, DAY, BLOCKED } from './social-kit.mjs'
import { sampleData, walk } from './social-data.mjs'

const TODAY = '2026-10-12' // NOW on the Page's clock
const person = (id, over = {}) => ({ id, name: { full: `Hero ${id}` }, image: { large: `https://s4.anilist.co/file/anilistcdn/character/large/b${id}-x.png` }, dateOfBirth: { month: 10, day: 12 }, favourites: 5000 - id, media: { edges: [{ node: { id: 1, type: 'ANIME', isAdult: false }, voiceActors: [{ name: { full: 'Voice' } }] }] }, ...over })
const answer = (list) => ({ data: { Page: { characters: list } } })
const fakeFetch = (json, calls = []) => async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) })
  return { ok: true, status: 200, json: async () => json }
}
const any = () => ({ mediaId: 1, voice: 'Voice' })

test('answer: only today, only well-known characters with a real picture, most-favourited first', () => {
  const list = birthdaysOf(answer([person(2), person(1), person(3, { dateOfBirth: { month: 10, day: 13 } }), person(4, { favourites: MIN_FAVOURITES - 1 }), person(5, { image: { large: 'https://s4.anilist.co/file/anilistcdn/character/large/default.jpg' } })]), TODAY)
  assert.deepEqual(list.map((c) => c.id), [1, 2])
  assert.deepEqual(list[0].media, [{ id: 1, voice: 'Voice' }])
  assert.deepEqual(birthdaysOf(null, TODAY), [])
})

test('ledger: AniList is asked once a day; the answer is kept and used all day', async () => {
  const book = memoryStore()
  const calls = []
  const fetch = fakeFetch(answer(Array.from({ length: 9 }, (_, i) => person(i + 1))), calls)
  const first = await loadBirthdays({ book, now: NOW, choose: any, fetch })
  assert.equal(first.list.length, MAX_PER_DAY)
  assert.equal(calls.length, 1)
  assert.match(calls[0].body.query, /isBirthday: true, sort: FAVOURITES_DESC/)
  const again = await loadBirthdays({ book, now: NOW + 5 * 3_600_000, choose: any, fetch })
  assert.deepEqual(again.list, first.list)
  assert.equal(calls.length, 1)
  assert.equal((await book.read()).data.birthdays.day, TODAY)
  // The next day is asked again.
  await loadBirthdays({ book, now: NOW + DAY, choose: any, fetch })
  assert.equal(calls.length, 2)
})

test('ledger: with nobody for this site it asks again only after a few hours', async () => {
  const book = memoryStore()
  const calls = []
  const fetch = fakeFetch(answer([person(1)]), calls)
  await loadBirthdays({ book, now: NOW, choose: () => null, fetch })
  await loadBirthdays({ book, now: NOW + RETRY_MS - 1, choose: () => null, fetch })
  assert.equal(calls.length, 1)
  await loadBirthdays({ book, now: NOW + RETRY_MS, choose: () => null, fetch })
  assert.equal(calls.length, 2)
  assert.equal(isFresh({ day: TODAY, at: NOW, list: [] }, '2026-10-13', NOW), false)
})

test('fails soft: an error or a refusal means no birthdays, never a thrown run', async () => {
  const said = []
  const broken = async () => ({ ok: false, status: 429, json: async () => ({}) })
  const result = await loadBirthdays({ book: memoryStore(), now: NOW, choose: any, fetch: broken, say: (line) => said.push(line) })
  assert.deepEqual(result.list, [])
  assert.match(said[0], /could not be read \(AniList answered 429\)/)
  const thrown = await loadBirthdays({ book: memoryStore(), now: NOW, choose: any, fetch: async () => { throw new Error('offline') } })
  assert.deepEqual(thrown.list, [])
})

test('runs: only a run with the birthday type switched on asks at all', async () => {
  const loadPools = async () => ({ pools: {}, data: { byId: new Map() }, source: 'x' })
  assert.equal(withBirthdays(loadPools, ['classic', { key: 'where' }], { book: memoryStore() }), loadPools)
  const calls = []
  const wrapped = withBirthdays(loadPools, [{ key: 'birthday', birthdays: () => any }], { book: memoryStore(), fetch: fakeFetch(answer([person(1)]), calls), say: () => {} })
  const loaded = await wrapped({ now: NOW })
  assert.equal(loaded.data.birthdays.list.length, 1)
  assert.equal(calls.length, 1)
})

test('find: today only, never the wrong day, and only a work with a page here', () => {
  const data = sampleData()
  const [post] = birthday.find(data, { now: NOW })
  assert.ok(post && post.item === 'bday:901' && post.path.startsWith('/'))
  assert.equal(post.title, null) // a birthday never stops another post about the same title
  assert.equal(birthday.find(data, { now: NOW + DAY }).length, 0)
  assert.equal(birthday.find({ ...data, birthdays: { ...data.birthdays, list: [{ ...data.birthdays.list[0], mediaId: 999999 }] } }, { now: NOW }).length, 0)
  assert.ok(GAP_DAYS >= 300 && birthday.gapDays === GAP_DAYS)
  const keep = birthday.birthdays(data)
  assert.equal(keep({ media: [{ id: 999999 }] }), null)
  assert.equal(keep({ media: [{ id: 999999 }, { id: data.birthdays.list[0].mediaId, voice: 'V' }] }).mediaId, data.birthdays.list[0].mediaId)
})

test('words and image: the greeting, who they are, the question, the hashtags; the name in a band', () => {
  const [post] = birthday.find(sampleData(), { now: NOW })
  for (let turn = 0; turn < birthday.captions.length; turn += 1) {
    const { caption } = captionFor({ ...birthday, captions: [birthday.captions[turn]] }, post, 0, BLOCKED)
    assert.match(caption, /Mira Vale/)
    assert.match(caption, /is a character in /)
    assert.match(caption, /#HappyBirthday/)
    assert.match(caption, /#MiraVale/)
  }
  const tree = birthday.template({ ...post.view, art: { hero: { src: 'data:image/jpeg;base64,AA==', ratio: 0.65 }, thumbs: [] } }, kitOf({ name: 'X', domain: 'x.com', color: { night: '#000000', raised: '#111111', accent: '#ff0000', paper: '#ffffff' }, font: {} }, {}))
  const { texts } = walk(tree)
  assert.ok(['HAPPY', 'BIRTHDAY', 'Mira Vale', '12', 'October'].every((word) => texts.includes(word)), texts.join('|'))
})
