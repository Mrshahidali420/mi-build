// The committed homepage plan files, and how the homepage reads them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SECTIONS } from '../src/lib/home-plan.mjs'
import { loadHomeAuto, homeShelf } from '../src/lib/home-auto.js'

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'))

test('the committed plan and rules parse and hold only known sections and whole ids', () => {
  const plan = read('home-auto.json')
  const rules = read('home-rules.json')
  const log = read('home-decisions.json')
  assert.match(plan.night, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(Array.isArray(log))
  const banned = new Set(rules.ban)
  for (const [key, section] of Object.entries(plan.sections)) {
    assert.ok(SECTIONS[key], `unknown section ${key}`)
    for (const it of section.items) {
      assert.ok(Number.isInteger(it.id))
      assert.ok(!banned.has(it.id), `banned id ${it.id} in ${key}`)
    }
  }
  for (const key of Object.keys(rules.pin)) assert.ok(SECTIONS[key], `pin for unknown section ${key}`)
  for (const id of [...rules.ban, ...Object.values(rules.pin).flat()]) assert.ok(Number.isInteger(id))
  for (const word of ['loli', 'lolicon']) assert.ok(rules.titleWordBlock.includes(word))
})

test('a missing or torn plan file means no auto sections, never a failed build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'home-auto-'))
  assert.equal(loadHomeAuto(join(dir, 'nope.json')), null)
  writeFileSync(join(dir, 'torn.json'), '{"night": "2026-09')
  assert.equal(loadHomeAuto(join(dir, 'torn.json')), null)
})

const planOf = (ids, enabled = true) => ({ night: '2026-09-27', sections: { saving: { enabled, title: 'Readers are saving', why: 'x', items: ids.map((id) => ({ id })) } } })
const lookup = (id) => (id === 404 ? undefined : { item: { id, title: `T${id}` } })

test('the homepage drops titles shown elsewhere and hides a short shelf', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7]
  assert.equal(homeShelf(planOf(ids), 'saving', { lookup }).items.length, 7)
  // Two of them are already in a Trending shelf: 5 left, under the floor of 6.
  assert.equal(homeShelf(planOf(ids), 'saving', { lookup, onPage: new Set([1, 2]) }), null)
  // Gone from the catalog since the plan was made: dropped too.
  assert.equal(homeShelf(planOf([...ids, 404]), 'saving', { lookup }).items.length, 7)
  assert.equal(homeShelf(planOf(ids, false), 'saving', { lookup }), null, 'a hidden section is not drawn')
  assert.equal(homeShelf(null, 'saving', { lookup }), null)
})
