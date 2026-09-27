// Tomorrow's homepage from tonight's plan. See src/lib/home-preview.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tomorrowOf } from '../src/lib/home-preview.js'
import { SECTIONS } from '../src/lib/home-plan.mjs'

const item = (id, nights, over = {}) => ({ id, path: `/manhwa/t-${id}`, title: `T${id}`, nights, pinned: false, ...over })

test('titles at their longest stay leave, pins never do, and next in line fills within the cap', () => {
  const max = SECTIONS.saving.maxStay
  const items = [item(1, max), item(2, max, { pinned: true }), ...[3, 4, 5, 6, 7, 8].map((id) => item(id, 2))]
  const plan = {
    sections: { saving: { enabled: true, items } },
    next: { saving: [item(1, 0), item(20, 0), item(21, 0), item(22, 0), item(23, 0), item(24, 0)] },
  }
  const [saving] = tomorrowOf(plan)
  assert.deepEqual(saving.leaves.map((t) => t.id), [1])
  assert.ok(saving.stays.some((t) => t.id === 2), 'a pin stays')
  // Title 1 leaves for its cooldown, so it cannot come straight back.
  assert.ok(!saving.joins.some((t) => t.id === 1))
  assert.equal(saving.joins.length, SECTIONS.saving.cap)
  assert.equal(saving.enabledTomorrow, true)
})

test('a short shelf is said to stay hidden; an empty plan gives nothing', () => {
  const plan = { sections: { new: { enabled: false, items: [item(1, 1)] } }, next: { new: [] } }
  const [neu] = tomorrowOf(plan)
  assert.equal(neu.enabledTomorrow, false)
  assert.deepEqual(tomorrowOf(null), [])
})

