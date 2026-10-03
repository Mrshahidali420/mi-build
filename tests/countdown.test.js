import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phrase } from '../src/lib/countdown-core.js'
import { dubOf } from '../src/lib/dub.mjs'
import { startedByClock } from '../src/lib/started.mjs'

test('the clock counts down, then says the episode is airing, then out', () => {
  assert.equal(phrase(42 * 60), 'in 42 minutes')
  assert.equal(phrase(0), 'airing now')
  assert.equal(phrase(-10 * 60), 'airing now')
  assert.equal(phrase(-3 * 3600), 'out now')
})

test('only a finished show can be called sub only', () => {
  const show = {
    kind: 'anime',
    status: 'NOT_YET_RELEASED',
    staff: [{ name: 'A director' }],
    characters: [{ name: 'Lead', voice: 'A Japanese voice' }],
  }
  assert.equal(dubOf(show), null)
  assert.equal(dubOf({ ...show, status: 'RELEASING' }), null)
  assert.equal(dubOf({ ...show, status: 'FINISHED' }).state, 'sub')
  const dubbed = { ...show, characters: [{ name: 'Lead', voice: 'JP', voiceEn: 'EN' }] }
  assert.equal(dubOf(dubbed).state, 'dub')
})

test('a show whose first episode time has passed counts as out', () => {
  const show = { kind: 'anime', status: 'NOT_YET_RELEASED', nextEpisode: { at: 1000, number: 1 } }
  assert.equal(startedByClock(show, 999), show)
  const out = startedByClock(show, 1001)
  assert.equal(out.status, 'RELEASING')
  assert.equal(out.nextEpisode, null)
  assert.equal(show.status, 'NOT_YET_RELEASED')
  // A start date with no hour never flips it.
  assert.equal(startedByClock({ kind: 'anime', status: 'NOT_YET_RELEASED' }, 1001).status, 'NOT_YET_RELEASED')
})
