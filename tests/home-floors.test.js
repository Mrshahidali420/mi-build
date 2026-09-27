// The people floors scaled to the site's traffic. See src/lib/home-floors.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scaleFloor, scaledFloors, floorsLine, MIN_PEOPLE } from '../src/lib/home-floors.mjs'
import { planHome, savingMiss, FLOORS } from '../src/lib/home-plan.mjs'
import { SEARCHING, webMiss, siteMiss } from '../src/lib/home-searching.mjs'
import { trafficFrom } from '../scripts/plan-home.mjs'

const RULES = JSON.parse(readFileSync(new URL('../data/home-rules.json', import.meta.url), 'utf8'))
const NIGHT = '2026-09-27'
const CEILINGS = {
  people7: FLOORS.people7,
  savers7: FLOORS.savers7,
  people30: FLOORS.people30,
  webPeople7: SEARCHING.webPeople7,
  sitePeople7: SEARCHING.sitePeople7,
}
const SMALL = { people7: 300, people30: 600 }
const NOW = { people7: 2014, people30: 4552 }
const LARGE = { people7: 100000, people30: 400000 }

test('the ceilings are the old fixed floors', () => {
  assert.deepEqual(CEILINGS, { people7: 20, savers7: 10, people30: 60, webPeople7: 10, sitePeople7: 5 })
})

test('small traffic: every floor sits at the minimum of 3 people', () => {
  assert.deepEqual(scaledFloors(SMALL, CEILINGS), { people7: 3, savers7: 3, people30: 3, webPeople7: 3, sitePeople7: 3 })
})

test("today's traffic: month 15, saving 5, rising and new 9, hot 6 and 3", () => {
  assert.deepEqual(scaledFloors(NOW, CEILINGS), { people7: 9, savers7: 5, people30: 15, webPeople7: 6, sitePeople7: 3 })
})

test('large traffic: every floor stops at its ceiling', () => {
  assert.deepEqual(scaledFloors(LARGE, CEILINGS), CEILINGS)
})

test('floors grow with traffic and never pass the ceiling or drop under 3', () => {
  let last = 0
  for (let t = 0; t <= 20000; t += 250) {
    const f = scaleFloor(t || 1, 0.0045, 20)
    assert.ok(f >= MIN_PEOPLE && f <= 20, `traffic ${t}: ${f}`)
    assert.ok(f >= last, 'never falls as traffic rises')
    last = f
  }
  assert.equal(scaleFloor(4000, 0.0045, 20), 18)
  assert.equal(scaleFloor(4445, 0.0045, 20), 20)
  assert.equal(scaleFloor(1e9, 0.0045, 20), 20, 'clamped to the ceiling')
  assert.equal(scaleFloor(10, 0.0045, 20), 3, 'never below 3')
  assert.equal(scaleFloor(10, 0.0045, 2), 2, 'a ceiling under 3 is still a ceiling')
})

test('unknown traffic keeps the old fixed floors, never lower ones', () => {
  for (const t of [null, undefined, {}, { people7: 0, people30: 0 }, { people7: NaN, people30: 5 }]) {
    assert.deepEqual(scaledFloors(t, CEILINGS), CEILINGS)
  }
})

test('the traffic answer is read carefully', () => {
  assert.deepEqual(trafficFrom([{ people7: 2014, people30: 4552 }]), NOW)
  assert.equal(trafficFrom([]), null)
  assert.equal(trafficFrom(undefined), null)
  assert.equal(trafficFrom([{ people7: null, people30: null }]), null, 'an empty table sums to null')
  assert.equal(trafficFrom([{ people7: 50, people30: 10 }]), null, 'a week bigger than its month makes no sense')
})

test('the log line fits the decisions reason', () => {
  const line = floorsLine({ people7: 123456, people30: 987654 }, scaledFloors(LARGE, CEILINGS))
  assert.ok(line.length <= 119, line)
  assert.match(floorsLine(null, CEILINGS), /traffic unknown/)
})

// ---------------------------------------------------------------- in the planner

const rec = (id, over = {}) => ({ id, title: `Title ${id}`, path: `/manhwa/t-${id}`, genres: ['Action'], tags: [], popularity: 5000, ...over })
// A title just over the minimum floors: 3 savers, 3 people, on 3 days.
const small = (over = {}) => ({
  saves7: 3, unsaves7: 0, savers7: 3, saveDays7: 3, opens7: 6, people7: 3,
  daysSeen7: 7, entries7: 5, quick7: 0, ...over,
})

function world(n, statOver = () => ({}), titleOver = () => ({})) {
  const titles = new Map()
  const stats = new Map()
  for (let id = 1; id <= n; id++) {
    titles.set(id, rec(id, titleOver(id)))
    stats.set(id, small(statOver(id)))
  }
  return { titles, stats }
}
const plan = (w, over = {}) => planHome({ night: NIGHT, titles: w.titles, stats: w.stats, rules: RULES, prev: null, ...over })

test('the planner uses the scaled floors, and without traffic the fixed ones', () => {
  const w = world(6)
  assert.equal(plan(w, { traffic: SMALL }).plan.sections.saving.items.length, 3, 'the change cap still holds')
  assert.equal(plan(w).plan.sections.saving.items.length, 0, 'no traffic: 10 savers needed, as before')
  assert.match(savingMiss(small(), rec(1), { floors: { ...FLOORS, savers7: 4 } }), /saved by 3 of 4 people/)
})

test('the floors are logged and written into the plan', () => {
  const { plan: p, decisions } = plan(world(1), { traffic: NOW })
  assert.deepEqual(p.floors.sections, { rising: 9, saving: 5, new: 9, month: 15, searching: 6 })
  assert.equal(p.floors.site, 3)
  assert.deepEqual(p.floors.traffic, NOW)
  const line = decisions.find((d) => d.rule === 'floors.scale')
  assert.equal(line.section, 'all')
  assert.match(line.reason, /2014 people this week, 4552 this month: rising\/new 9, saving 5, month 15, hot 6\/3/)
})

test('hot this week reads the scaled search floors', () => {
  const floors = { webPeople7: 6, sitePeople7: 3 }
  const s = { gPeople7: 6, gDays7: 3, g7: 6, sPeople7: 3, sDays7: 3, s7: 3 }
  assert.equal(webMiss(s, { floors, searchMode: 'volume' }), null)
  assert.match(webMiss(s, { searchMode: 'volume' }), /6 of 10 people/)
  assert.equal(siteMiss(s, { floors }), null)
  assert.match(siteMiss(s), /3 of 5 people/)
})

test('every other guardrail still holds at the lowest floors', () => {
  const bad = {
    1: [{ daysSeen7: 2 }, {}],                          // 3-day spread
    2: [{ saveDays7: 2 }, {}],                          // saves on 3 days
    3: [{ saves7: 9, savers7: 3 }, {}],                 // one-visitor share
    4: [{}, { genres: ['Ecchi'] }],                     // adult filter
    5: [{}, { title: 'Loli Days' }],                    // adult title word
    6: [{}, {}],                                        // block.json
    7: [{ unsaves7: 3 }, {}],                           // changed minds
    8: [{ entries7: 30, quick7: 25 }, {}],              // quick exits
    9: [{ daysSeen7: 4 }, { popularity: 10 }],          // unknown on AniList
    10: [{ savers7: 2, saves7: 2 }, {}],                // under the minimum of 3
  }
  const w = world(10, (id) => bad[id][0], (id) => bad[id][1])
  const { plan: p } = plan(w, { traffic: SMALL, blocked: new Set([6]) })
  for (const key of Object.keys(p.sections)) assert.equal(p.sections[key].items.length, 0, key)

  // A ban and a Trending cover still win over a title that qualifies.
  const ok = world(4)
  const { plan: q } = plan(ok, { traffic: SMALL, onPage: new Set([1]), rules: { ...RULES, ban: [2] } })
  const ids = Object.values(q.sections).flatMap((s) => s.items.map((it) => it.id))
  assert.ok(!ids.includes(1) && !ids.includes(2))
  assert.equal(new Set(ids).size, ids.length, 'no title twice')
  // Two titles qualify, the shelf needs 6: it stays hidden.
  assert.equal(q.sections.saving.enabled, false)
})
