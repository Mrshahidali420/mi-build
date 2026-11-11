import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postStory, storiesPerDayOf, storiesToday } from '../scripts/social/page-story.mjs'

const NOW = 1_800_000_000_000
const book = { read: async () => ({ data: { entries: [] } }), update: async () => {} }
const entry = { key: 'k', type: 'clip-reel' }
const calls = []
const graph = { publishStory: async ({ bytes }) => (calls.push(['fb', bytes.length]), { storyId: 'fb1' }) }
const ig = { off: false, settings: {}, client: { publishStory: async ({ bytes }) => (calls.push(['ig', bytes.length]), { mediaId: 'ig1' }) } }
const base = { graph, ig, book, entry, now: NOW, out: [], bytes: Buffer.from('video'), seconds: 20, perDay: 5 }

test('stories: the number a day is read from the variable, off when unset', () => {
  assert.deepEqual([storiesPerDayOf(undefined), storiesPerDayOf('0'), storiesPerDayOf('10'), storiesPerDayOf('999')], [0, 0, 10, 50])
})

test('stories: a clip reel goes out as a Facebook story and an Instagram story', async () => {
  calls.length = 0
  const done = await postStory({ ...base, book: { read: async () => ({ data: { entries: [{ key: 'k' }] } }), update: async () => {}, write: async () => {} } })
  assert.equal(done.fb, 'fb1')
  assert.equal(done.ig, 'ig1')
  assert.deepEqual(calls.map((c) => c[0]), ['fb', 'ig'])
})

test('stories: another kind, no number set, or the day full means no story', async () => {
  calls.length = 0
  assert.equal(await postStory({ ...base, entry: { key: 'k', type: 'fact' } }), null)
  assert.equal(await postStory({ ...base, perDay: 0 }), null)
  const full = Array.from({ length: 5 }, () => ({ story: { at: NOW - 1000 } }))
  assert.equal(storiesToday(full, NOW), 5)
  assert.equal(await postStory({ ...base, history: full }), null)
  assert.equal(calls.length, 0)
})

test('stories: a failed Facebook story does not stop the Instagram one', async () => {
  const bad = { publishStory: async () => { throw new Error('nope') } }
  const done = await postStory({ ...base, graph: bad, book: { read: async () => ({ data: { entries: [{ key: 'k' }] } }), update: async () => {}, write: async () => {} } })
  assert.equal(done.fbError, 'nope')
  assert.equal(done.ig, 'ig1')
})
