import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickThinQueue, isThinRecord, RECHECK_DAYS } from '../scripts/enrich-queue.mjs'

const thin = (id, checkedOn) => ({ id, slug: `c-${id}`, ...(checkedOn ? { checkedOn } : {}) })

test('a record with a bio, or with no AniList id, is never queued', () => {
  assert.equal(isThinRecord({ id: 1, description: 'A bio.' }), false)
  assert.equal(isThinRecord({ slug: 'no-id-here' }), false)
  assert.equal(isThinRecord({ slug: 'kim-123' }), true, 'the id is read off the slug')
})

test('never-asked records go first, then the oldest ask', () => {
  const people = [thin(1, '2026-08-01'), thin(2), thin(3, '2026-07-01'), thin(4)]
  assert.deepEqual(pickThinQueue(people, '2026-10-23', 10).map((p) => p.id), [2, 4, 3, 1])
})

test('a record asked recently waits, so the queue walks the rest', () => {
  const people = [thin(1, '2026-10-22'), thin(2, '2026-10-01'), thin(3)]
  assert.deepEqual(pickThinQueue(people, '2026-10-23', 10).map((p) => p.id), [3])
  const later = new Date(Date.parse('2026-10-22') + (RECHECK_DAYS + 1) * 86_400_000).toISOString().slice(0, 10)
  assert.ok(pickThinQueue(people, later, 10).some((p) => p.id === 1), 'asked again after a month')
})

test('two runs in a row never ask the same records (the 21 Oct bug)', () => {
  const people = Array.from({ length: 10 }, (_, i) => thin(i + 1))
  const first = pickThinQueue(people, '2026-10-23', 4)
  for (const p of first) p.checkedOn = '2026-10-23'
  const second = pickThinQueue(people, '2026-10-23', 4)
  assert.equal(second.filter((p) => first.includes(p)).length, 0)
  assert.equal(second.length, 4)
})
