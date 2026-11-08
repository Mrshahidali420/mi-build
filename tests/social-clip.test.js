// Clips of a trending episode (types/clip.mjs, clip/store.mjs): which clips are offered,
// the caption they get, and the store that fails soft.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captionFor } from '../scripts/social/plan.mjs'
import { downloadClip, loadClips } from '../scripts/social/clip/store.mjs'
import { KINDS } from '../scripts/social/types/index.mjs'
import { clipReel, clipVideo } from '../scripts/social/types/clip.mjs'
import { NOW, BLOCKED } from './social-kit.mjs'
import { sampleData } from './social-data.mjs'

const item = (over = {}) => ({
  id: 'clip-frieren-e07-whereanime-01', page: 'whereanime', anilist_id: 1, anime: 'Solo Leveling', episode: 7,
  title: 'Solo Leveling Episode 7: the fight everyone waited for', caption: 'x', comment: 'Which scene was your favourite?',
  full_id: 11, short_id: 12, full_seconds: 190, short_seconds: 60, made_at: NOW / 1000 - 3600, ...over,
})
const dataWith = (items) => ({ ...sampleData(), clips: { items } })

test('both clip kinds are known to the poster, and only the short is a reel', () => {
  assert.ok(KINDS.includes(clipReel) && KINDS.includes(clipVideo))
  assert.equal(clipReel.reel, true)
  assert.equal(clipVideo.reel, undefined)
  assert.equal(clipVideo.video, true)
})

test('a clip of a known title is offered as a short and as a full video, each with its own item id', () => {
  const data = dataWith([item()])
  const short = clipReel.find(data, { now: NOW })
  const full = clipVideo.find(data, { now: NOW })
  assert.equal(short.length, 1)
  assert.equal(full.length, 1)
  assert.notEqual(short[0].item, full[0].item)
  assert.equal(short[0].clip.seconds, 60)
  assert.equal(full[0].clip.seconds, 190)
})

test('no clip for an unknown title, a short that is too long for a reel, or no clips at all', () => {
  assert.equal(clipReel.find(dataWith([item({ anilist_id: 99999 })]), { now: NOW }).length, 0)
  assert.equal(clipReel.find(dataWith([item({ short_seconds: 120 })]), { now: NOW }).length, 0)
  assert.equal(clipVideo.find({ ...sampleData() }, { now: NOW }).length, 0)
})

test('the caption has the hook, the question, the line about the first comment and a few tags', () => {
  const [post] = clipReel.find(dataWith([item()]), { now: NOW })
  const made = captionFor(clipReel, post, 0, BLOCKED)
  assert.ok(made, 'a caption was made')
  assert.match(made.caption, /Solo Leveling Episode 7/)
  assert.match(made.caption, /Which scene was your favourite\?/)
  assert.match(made.caption, /link is in the first comment/)
})

test('the store: no token means no clips, a list that cannot be read means no clips, never an error', async () => {
  assert.deepEqual((await loadClips({ env: {}, now: NOW })).items, [])
  const down = async () => ({ ok: false, status: 500 })
  assert.deepEqual((await loadClips({ env: { CLIPS_TOKEN: 't' }, fetch: down, now: NOW })).items, [])
  const boom = async () => { throw new Error('offline') }
  assert.deepEqual((await loadClips({ env: { CLIPS_TOKEN: 't' }, fetch: boom, now: NOW })).items, [])
})

test('the store: only the last days, newest first', async () => {
  const items = [item({ id: 'old', made_at: NOW / 1000 - 9 * 86400 }), item({ id: 'a', made_at: NOW / 1000 - 7200 }), item({ id: 'b', made_at: NOW / 1000 - 60 })]
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ items }) })
  const got = await loadClips({ env: { CLIPS_TOKEN: 't' }, fetch, now: NOW })
  assert.deepEqual(got.items.map((i) => i.id), ['b', 'a'])
})

test('a download that is too small is refused', async () => {
  const fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(10) })
  await assert.rejects(downloadClip(item(), 'short', { env: { CLIPS_TOKEN: 't' }, fetch }), /too small/)
})
