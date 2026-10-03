import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phrase } from '../src/lib/countdown-core.js'
import { dubOf } from '../src/lib/dub.mjs'

test('the clock counts down, then says the episode is airing, then out', () => {
  assert.equal(phrase(42 * 60), 'in 42 minutes')
  assert.equal(phrase(0), 'airing now')
  assert.equal(phrase(-10 * 60), 'airing now')
  assert.equal(phrase(-3 * 3600), 'out now')
})

test('a show not out yet makes no sub-only claim', () => {
  const show = {
    kind: 'anime',
    status: 'NOT_YET_RELEASED',
    staff: [{ name: 'A director' }],
    characters: [{ name: 'Lead', voice: 'A Japanese voice' }],
  }
  assert.equal(dubOf(show), null)
  assert.equal(dubOf({ ...show, status: 'RELEASING' }).state, 'sub')
})
