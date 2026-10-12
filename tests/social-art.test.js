// Fan art and cosplay (art/, types/art-card.mjs): the safety gate, the
// Danbooru adapter on a recorded answer, matching a picture to a title of
// the site, never twice the same picture, at most one ecchi-leaning picture
// in four art posts, at most one art post in eight, and the credit line in
// the first comment. No network: every answer is recorded or made up here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { kindsNow, RARE_EVERY } from '../scripts/social/attempt.mjs'
import { characterTag, originalOf, tagName, tagVariants, toItem } from '../scripts/social/art/danbooru.mjs'
import { charactersFor, ecchiAllowed, loadArt, sameSeries, seenOf, titleFor, ECCHI_EVERY } from '../scripts/social/art/load.mjs'
import { ecchiOf, isSafe, unsafeReason } from '../scripts/social/art/safe.mjs'
import { memoryStore } from '../scripts/social/ledger.mjs'
import { captionFor } from '../scripts/social/plan.mjs'
import { kitOf } from '../scripts/social/render/parts.mjs'
import { typedEntry } from '../scripts/social/send.mjs'
import { commentFor } from '../scripts/social/site.mjs'
import { artType } from '../scripts/social/types/art-card.mjs'
import { NOW, BLOCKED } from './social-kit.mjs'
import { walk } from './social-data.mjs'

const REC = JSON.parse(readFileSync(new URL('./fixtures/danbooru-posts.json', import.meta.url), 'utf8'))
const item = (over = {}) => ({ rating: 'g', tags: ['1girl', 'smile'], characters: ['frieren'], text: '', flagged: false, ...over })
const FRIEREN = { id: 1, title: "Frieren: Beyond Journey's End", alt: 'Sousou no Frieren', verb: 'watch', path: '/anime/frieren', section: 'anime', popularity: 500000, cast: [{ id: 9, name: 'Frieren' }] }

// --- the gate --------------------------------------------------------------------

test('gate: general and sensitive pass, an adult character in a swimsuit included', () => {
  assert.equal(unsafeReason(item()), null)
  const swim = item({ rating: 's', tags: ['1girl', 'swimsuit', 'bikini', 'cleavage', 'beach'] })
  assert.equal(unsafeReason(swim), null)
  assert.equal(ecchiOf(swim), true)
  assert.equal(ecchiOf(item()), false)
  assert.equal(ecchiOf(item({ tags: ['thighs'] })), true)
})

test('gate: questionable, explicit, no rating, an NSFW flag, nudity and sex are out', () => {
  assert.match(unsafeReason(item({ rating: 'q' })), /rated q/)
  assert.match(unsafeReason(item({ rating: 'e' })), /rated e/)
  assert.match(unsafeReason(item({ rating: null })), /no rating/)
  assert.match(unsafeReason(item({ nsfw: true })), /NSFW/)
  assert.match(unsafeReason(item({ over18: true })), /NSFW/)
  for (const tag of ['nude', 'topless', 'nipples', 'censored', 'sex', 'bondage', 'see-through', 'nude_filter']) assert.ok(unsafeReason(item({ rating: 's', tags: ['1girl', tag] })), tag)
  assert.match(unsafeReason(item({ text: 'a nude study' })), /nudity in the text/)
  assert.ok(unsafeReason(item({ flagged: true })))
})

test('gate: the hard line on minors, whatever else is allowed', () => {
  for (const tag of ['loli', 'shota', 'child', 'toddler', 'underage', 'young']) assert.match(unsafeReason(item({ tags: ['1girl', tag] })), /tag/, tag)
  assert.match(unsafeReason(item({ tags: ['school_uniform', 'swimsuit'] })), /school age/)
  assert.match(unsafeReason(item({ rating: 's', tags: ['serafuku', 'smile'] })), /school age/)
  // A school uniform with nothing suggestive, rated general, is fine.
  assert.equal(unsafeReason(item({ tags: ['school_uniform', 'smile'] })), null)
})

// --- Danbooru ---------------------------------------------------------------------

test('danbooru: a recorded post becomes the common shape, with the credit and the source', () => {
  const art = toItem(REC.fanart[0])
  assert.equal(art.id, `danbooru:${REC.fanart[0].id}`)
  assert.equal(art.hash, REC.fanart[0].md5)
  assert.equal(art.rating, 'g')
  assert.ok(art.series.includes('sousou_no_frieren'))
  assert.ok(art.image.startsWith('https://cdn.donmai.us/'))
  assert.ok(art.credit.name && art.credit.url.startsWith('http'))
  // A big original is taken as Danbooru's sample, which the slow host serves quickly.
  const big = REC.fanart.find((p) => p.file_size > 2_500_000)
  if (big) assert.equal(toItem(big).image, big.large_file_url)
  for (const post of REC.sensitive) assert.equal(toItem(post).rating, 's')
  assert.equal(toItem({ ...REC.fanart[0], image_width: 400, image_height: 500 }), null) // too small
  assert.equal(toItem({ ...REC.fanart[0], parent_id: 5 }).flagged, true) // a variant of another post
  assert.equal(originalOf({ source: 'https://i.pximg.net/img-original/img/1_p0.jpg', pixiv_id: 141163346 }), 'https://www.pixiv.net/artworks/141163346')
  assert.equal(originalOf({ source: 'https://i.pximg.net/img-original/img/1_p0.jpg' }), null)
  assert.equal(originalOf({ source: 'file://x.jpg' }), null)
  assert.equal(tagName('emiya_shirou'), 'Emiya Shirou')
  assert.equal(tagName('makima_(chainsaw_man)'), 'Makima')
  assert.deepEqual(tagVariants('Tanjirou Kamado'), ['tanjirou_kamado', 'kamado_tanjirou'])
})

test('danbooru: the character tag is the best-used one among the ways the name is written', async () => {
  const urls = []
  const fetch = async (url) => {
    urls.push(url)
    return { ok: true, json: async () => REC.tags }
  }
  assert.equal(await characterTag('Frieren', { fetch }), 'frieren')
  assert.match(urls[0], /search\[name_comma\]=frieren&search\[category\]=4/)
  assert.equal(await characterTag('Frieren', { fetch: async () => ({ ok: true, json: async () => [{ name: 'frieren', post_count: 3, category: 4 }] }) }), null)
})

// --- matching and the rules ---------------------------------------------------------

test('match: a picture goes to the title its series tag names, and only that one', () => {
  assert.equal(sameSeries(['sousou_no_frieren'], FRIEREN), true)
  assert.equal(sameSeries(['original'], FRIEREN), false)
  assert.equal(titleFor(['yu-gi-oh!'], [FRIEREN]), null)
  assert.equal(charactersFor([FRIEREN], NOW).length, 1)
})

test('never twice: the ids and md5 of posted pictures are kept beyond the ledger, dry runs aside', () => {
  const ledger = { artSeen: ['danbooru:1'], entries: [{ type: 'fanart', item: 'danbooru:2', hash: 'abc', status: 'posted' }, { type: 'fanart', item: 'danbooru:3', status: 'dry' }] }
  assert.deepEqual([...seenOf(ledger)].sort(), ['abc', 'danbooru:1', 'danbooru:2'])
})

test('ecchi: at most one ecchi-leaning picture in four art posts', () => {
  const art = (ecchi, at) => ({ type: 'cosplay', ecchi, at, status: 'posted', page: 'p' })
  assert.equal(ECCHI_EVERY, 4)
  assert.equal(ecchiAllowed({ entries: [art(true, 1), art(false, 2), art(false, 3), art(false, 4)] }, 'p'), true)
  assert.equal(ecchiAllowed({ entries: [art(false, 1), art(true, 2), art(false, 3)] }, 'p'), false)
})

test('loader: fan art of the hour, matched, checked, and never one already posted', async () => {
  const fetch = async (url) => ({ ok: true, json: async () => (url.includes('/tags.json') ? REC.tags : url.includes('cosplay_photo') ? REC.cosplay : REC.fanart) })
  const book = memoryStore({ v: 1, entries: [], artSeen: [`danbooru:${REC.fanart[0].id}`] })
  const said = []
  const art = await loadArt({ book, now: NOW, titles: [FRIEREN], wants: new Set(['fanart', 'cosplay']), fetch, say: (l) => said.push(l) })
  assert.ok(art.fanart.length >= 1)
  assert.ok(art.fanart.every((a) => a.title === FRIEREN && a.character === 'Frieren' && isSafe(a)))
  assert.ok(!art.fanart.some((a) => a.id === `danbooru:${REC.fanart[0].id}`))
  assert.equal(art.cosplay.length, 0) // the recorded cosplay is of series this site does not have
  assert.match(said.at(-1), /Pictures this hour/)
  const broken = await loadArt({ book, now: NOW, titles: [FRIEREN], wants: new Set(['fanart']), fetch: async () => ({ ok: false, status: 503 }), say: () => {} })
  assert.deepEqual(broken.fanart, [])
})

test('mix: fan art and cosplay together at most one post in eight, never two in a row', () => {
  const kinds = ['classic', { key: 'where' }, { key: 'fanart', rare: true }, { key: 'cosplay', rare: true }]
  const plain = Array.from({ length: RARE_EVERY - 1 }, (_, i) => ({ at: i }))
  assert.equal(kindsNow(kinds, plain, NOW, 3).length, 4)
  assert.equal(kindsNow(kinds, [...plain.slice(1), { at: 9, rare: true }], NOW, 3).length, 2)
  assert.equal(kindsNow(kinds, [{ rare: true }, ...plain.slice(1)], NOW, 3).length, 2)
})

// --- the type ------------------------------------------------------------------------

test('type: words, the ledger record, the credit line, and the picture as the hero', () => {
  const type = artType({ kind: 'fanart', verb: 'watch' })
  const picture = { ...toItem(REC.fanart[1]), ecchi: false, title: FRIEREN, character: 'Frieren' }
  const [post] = type.find({ art: { fanart: [picture] } }, { now: NOW })
  assert.equal(post.title, null)
  const { caption } = captionFor(type, post, 0, BLOCKED)
  assert.match(caption, /^🎨 Fan art of Frieren from Frieren: Beyond Journey's End\./)
  assert.match(caption, /#Frieren/)
  assert.match(caption, /#fanart/)
  const comment = commentFor(post).split('\n')
  assert.match(comment[0], /\/anime\/frieren/)
  assert.match(comment[1], /^Art by .+: https?:\/\//)
  const entry = typedEntry({ type, post, variant: 0 }, '2026-10-12', NOW)
  assert.deepEqual([entry.rare, entry.rating, entry.ecchi, entry.hash], [true, 'g', false, picture.hash])
  const tree = type.template({ ...post.view, art: { hero: { src: 'data:image/jpeg;base64,AA==', ratio: 0.7 }, thumbs: [] } }, kitOf({ name: 'X', domain: 'x.com', color: { night: '#000000', raised: '#111111', accent: '#ff0000', paper: '#ffffff' }, font: {} }, {}))
  const { texts, images } = walk(tree)
  assert.ok(texts.includes('Fan art') && texts.includes('Frieren'))
  assert.equal(images.length, 1)
  // Without an artist the credit line is left out, and the picture is still used.
  const [bare] = type.find({ art: { fanart: [{ ...picture, artist: null, credit: null }] } }, { now: NOW })
  assert.equal(commentFor(bare).split('\n').length, 1)
  // A title of the other verb (a comic on an anime Page) is never used.
  assert.equal(type.find({ art: { fanart: [{ ...picture, title: { ...FRIEREN, verb: 'read' } }] } }, { now: NOW }).length, 0)
})
