// Instagram (scripts/social/ig.mjs): the same post after Facebook, its own
// switch and cap, "link in bio" for the first comment, pictures fitted inside
// Instagram's shapes, and a failure that never touches Facebook.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { GRAPH_VERSION } from '../scripts/social/fb.mjs'
import { BIO_LINE, IG_DEFAULT_PER_DAY, IG_MAX_PER_DAY, fitImage, frameOf, igCaption, igClient, igSettingsOf, igWhyNot, igWords } from '../scripts/social/ig.mjs'
import { TYPES } from '../scripts/social/types/index.mjs'
import { NOW, HOUR, harness, pools } from './social-kit.mjs'
import { sampleData } from './social-data.mjs'

test('ig settings: off unless IG_POST_ENABLED is exactly true; the Page token is used when IG_TOKEN is unset', () => {
  assert.equal(igSettingsOf({}).enabled, false)
  assert.equal(igSettingsOf({ IG_POST_ENABLED: 'yes' }).enabled, false)
  const s = igSettingsOf({ IG_POST_ENABLED: 'true', IG_USER_ID: ' 17841 ', FB_PAGE_TOKEN: 'page' })
  assert.deepEqual([s.enabled, s.configured, s.userId, s.token, s.perDay, s.types], [true, true, '17841', 'page', IG_DEFAULT_PER_DAY, null])
  assert.equal(igSettingsOf({ IG_USER_ID: '1', IG_TOKEN: 'own', FB_PAGE_TOKEN: 'page' }).token, 'own')
  assert.equal(igSettingsOf({ IG_USER_ID: '1' }).configured, false)
  assert.equal(igSettingsOf({ IG_POSTS_PER_DAY: '500' }).perDay, IG_MAX_PER_DAY)
  assert.deepEqual([...igSettingsOf({ IG_POST_TYPES: 'Classic, fanart' }).types], ['classic', 'fanart'])
})

test('ig words: the line about the first comment becomes "link in bio", in the caption and on the picture', () => {
  const caption = '✨ Juliet Persia fan art, from Boarding School Juliet.\nArt by Unacchi, credited in the first comment.\n\nWhich character next?\n\n👇 Where to read it, free and paid: see the first comment.\n\n#fanart'
  assert.equal(igCaption(caption), `✨ Juliet Persia fan art, from Boarding School Juliet.\nArt by Unacchi.\n\nWhich character next?\n\n${BIO_LINE}\n\n#fanart`)
  assert.equal(BIO_LINE, '🔗 Link in bio: manhwaindex.com')
  assert.equal(igWords('Where to read it: link in the first comment'), 'Where to read it: link in bio')
  assert.equal(igWords('👇 Start with #1: the link is in the first comment.'), '👇 Start with #1: link in bio.')
  assert.equal(igWords('Nothing to change'), 'Nothing to change')
})

test('ig pace: its own cap, spread evenly, only the kinds named, never a reel', () => {
  const settings = igSettingsOf({ IG_POSTS_PER_DAY: '8' })
  const entry = { type: 'where' }
  assert.equal(igWhyNot({ settings, history: [], now: NOW, entry }), null)
  assert.match(igWhyNot({ settings, history: [], now: NOW, entry: { reel: true, type: 'reel-x' } }), /reels/)
  assert.match(igWhyNot({ settings: igSettingsOf({ IG_POST_TYPES: 'fanart' }), history: [], now: NOW, entry }), /where is not on IG_POST_TYPES/)
  assert.equal(igWhyNot({ settings: igSettingsOf({ IG_POST_TYPES: 'classic' }), history: [], now: NOW, entry: {} }), null)
  // Eight a day is one every three hours; a little early is fine, an hour later is not.
  assert.match(igWhyNot({ settings, history: [{ ig: { id: 'm', at: NOW - HOUR } }], now: NOW, entry }), /60 minutes ago/)
  assert.equal(igWhyNot({ settings, history: [{ ig: { id: 'm', at: NOW - 2.5 * HOUR } }], now: NOW, entry }), null)
  // A failed try counts for the spacing, not for the cap.
  assert.match(igWhyNot({ settings, history: [{ ig: { error: 'x', at: NOW - HOUR } }], now: NOW, entry }), /minutes ago/)
  const full = Array.from({ length: 8 }, (_, i) => ({ ig: { id: `m${i}`, at: NOW - (20 - i) * HOUR } }))
  assert.match(igWhyNot({ settings, history: full, now: NOW, entry }), /8 Instagram posts/)
})

test('ig pictures: 4:5 to 1.91:1 go as they are; anything taller or wider is placed whole on the page colour', async () => {
  assert.equal(frameOf(1080, 1350), null)
  assert.equal(frameOf(1080, 1080), null)
  assert.deepEqual(frameOf(1080, 1616), { width: 1293, height: 1616 })
  assert.deepEqual(frameOf(460, 650), { width: 520, height: 650 })
  assert.deepEqual(frameOf(2000, 800), { width: 2000, height: 1048 })
  const tall = await sharp({ create: { width: 1080, height: 1616, channels: 3, background: '#ff0000' } }).jpeg().toBuffer()
  const meta = await sharp(await fitImage(tall, { sharp, background: '#101010' })).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.ok(meta.width / meta.height >= 0.8 - 1e-3 && meta.width <= 1440, `${meta.width}x${meta.height}`)
  const big = await sharp({ create: { width: 2160, height: 2700, channels: 3, background: '#00ff00' } }).png().toBuffer()
  const fitted = await sharp(await fitImage(big, { sharp })).metadata()
  assert.deepEqual([fitted.width, fitted.height, fitted.format], [1440, 1800, 'jpeg'])
})

function fakeFetch(answers) {
  const seen = []
  const fetch = async (url, init = {}) => {
    seen.push({ url, init })
    const next = answers.shift()
    return { ok: (next.status || 200) < 400, status: next.status || 200, headers: { get: () => null }, json: async () => next.json }
  }
  return { fetch, seen }
}

test('ig client: a container, a wait until Instagram has the picture, then the post', async () => {
  const { fetch, seen } = fakeFetch([{ json: { id: 'c1' } }, { json: { status_code: 'IN_PROGRESS' } }, { json: { status_code: 'FINISHED' } }, { json: { id: 'm1' } }])
  const client = igClient({ userId: '178', token: 'TOKEN', fetch })
  const waits = []
  assert.deepEqual(await client.publish({ imageUrl: 'https://fbcdn/x.jpg', caption: 'Hi', sleep: async (ms) => waits.push(ms) }), { mediaId: 'm1' })
  assert.equal(seen[0].url, `https://graph.facebook.com/${GRAPH_VERSION}/178/media`)
  assert.match(seen[0].init.body, /image_url=https%3A%2F%2Ffbcdn%2Fx\.jpg&caption=Hi&access_token=TOKEN/)
  assert.match(seen[1].url, /\/c1\?fields=status_code%2Cstatus&access_token=TOKEN$/)
  assert.equal(seen[3].url, `https://graph.facebook.com/${GRAPH_VERSION}/178/media_publish`)
  assert.match(seen[3].init.body, /creation_id=c1/)
  assert.deepEqual(waits, [5000])
  const refused = fakeFetch([{ json: { id: 'c2' } }, { json: { status_code: 'ERROR', status: 'Error: unsupported aspect ratio' } }])
  await assert.rejects(igClient({ userId: '178', token: 'T', fetch: refused.fetch }).publish({ imageUrl: 'u', caption: 'c' }), /unsupported aspect ratio/)
})

// --- a whole run ----------------------------------------------------------

const LIVE = { FB_PAGE_ID: '1', FB_PAGE_TOKEN: 't', FB_POST_ENABLED: 'true', EVENT: 'schedule', FB_POST_TYPES: 'where' }
const IG_ON = { IG_POST_ENABLED: 'true', IG_USER_ID: '178' }

async function igRun(env, { publish } = {}) {
  const order = []
  const graph = {
    pageName: async () => 'Page',
    publishPhotoFile: async () => (order.push('fb'), { postId: 'p1', photoId: 'ph1' }),
    comment: async () => (order.push('comment'), { commentId: 'c1' }),
    hostPhoto: async ({ bytes }) => (order.push(['host', (await sharp(bytes).metadata()).format]), { photoId: 'hidden1' }),
    photoUrl: async (id) => `https://fbcdn.example/${id}.jpg`,
  }
  const sent = []
  const instagram = {
    username: async () => 'manhwaindexofficial',
    publish: publish || (async (args) => (order.push('ig'), sent.push(args), { mediaId: 'm1' })),
  }
  const words = []
  const h = harness({ ...LIVE, ...env }, graph)
  const picture = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#202020' } }).jpeg().toBuffer()
  const code = await h.run({
    loadPools: async () => ({ pools: pools(), data: sampleData(), source: 'test' }),
    loadTypes: async () => TYPES,
    render: async (type, post, { words: w } = {}) => {
      words.push(w ? w('Where to read it: link in the first comment') : null)
      return { png: picture, jpeg: picture }
    },
    makeInstagram: () => instagram,
  })
  return { ...h, code, order, sent, words }
}

test('run: Instagram off by default; nothing is sent there and the account is never asked', async () => {
  const r = await igRun({})
  assert.equal(r.code, 0)
  assert.ok(!r.order.includes('ig') && !r.order.some((o) => o[0] === 'host'))
  assert.doesNotMatch(r.text.join(''), /Instagram/)
})

test('run: switched on, the Facebook post goes first, then the same post on Instagram with "link in bio"', async () => {
  const r = await igRun(IG_ON)
  assert.equal(r.code, 0)
  assert.deepEqual(r.order.slice(0, 4), ['fb', 'comment', ['host', 'jpeg'], 'ig'])
  assert.equal(r.sent[0].imageUrl, 'https://fbcdn.example/hidden1.jpg')
  assert.ok(r.sent[0].caption.includes(BIO_LINE) && !/first comment/.test(r.sent[0].caption), r.sent[0].caption)
  // The picture is drawn again for Instagram, with "link in bio" on it.
  assert.deepEqual(r.words, [null, 'Where to read it: link in bio'])
  const [entry] = r.store.snapshot().entries
  assert.deepEqual([entry.status, entry.ig.id, typeof entry.ig.at], ['posted', 'm1', 'number'])
  assert.match(r.text.join(''), /Instagram: token works for \*\*@manhwaindexofficial\*\*\. Up to 8 posts in any 24 hours\./)
  assert.match(r.text.join(''), /Instagram: posted m1\./)
})

test('run: an Instagram failure is written down and said; the Facebook post stands and the run stays green', async () => {
  const r = await igRun(IG_ON, { publish: async () => Promise.reject(new Error('Instagram could not take the picture: ERROR')) })
  assert.equal(r.code, 0)
  const [entry] = r.store.snapshot().entries
  assert.deepEqual([entry.status, entry.commentId, entry.ig.error], ['posted', 'c1', 'Instagram could not take the picture: ERROR'])
  assert.match(r.text.join(''), /Instagram: \*\*failed\*\* \(Instagram could not take the picture: ERROR\)\. Facebook is not affected\./)
  assert.equal(r.store.snapshot().health?.halted || null, null)
})

test('run: switched on without the IG_USER_ID secret, it says so and posts to Facebook only', async () => {
  const r = await igRun({ IG_POST_ENABLED: 'true' })
  assert.equal(r.code, 0)
  assert.ok(!r.order.includes('ig'))
  assert.match(r.text.join(''), /Instagram: \*\*not configured\*\*/)
  assert.equal(r.store.snapshot().entries[0].status, 'posted')
})
