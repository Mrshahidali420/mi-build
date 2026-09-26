// The homepage planner's rules, with fixed numbers. See src/lib/home-plan.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  planHome, savingMiss, savingScore, adultReason, hasWord, loopDrops, mergeDecisions,
  addDays, SECTIONS, FLOORS, DROP,
} from '../src/lib/home-plan.mjs'

const RULES = JSON.parse(readFileSync(new URL('../data/home-rules.json', import.meta.url), 'utf8'))
const NIGHT = '2026-09-27'

// A title that passes every floor, with room to spare.
const good = (over = {}) => ({
  saves7: 14, unsaves7: 1, savers7: 12, saveDays7: 4, opens7: 300, people7: 80,
  daysSeen7: 7, entries7: 40, quick7: 5, ...over,
})
const rec = (id, over = {}) => ({ id, title: `Title ${id}`, path: `/manhwa/t-${id}`, genres: ['Action'], tags: [], popularity: 5000, ...over })

function world(n, statOver = () => ({})) {
  const titles = new Map()
  const stats = new Map()
  for (let id = 1; id <= n; id++) {
    titles.set(id, rec(id))
    stats.set(id, good({ savers7: 10 + id, saves7: 10 + id, ...statOver(id) }))
  }
  return { titles, stats }
}

const plan = (w, over = {}) => planHome({ night: NIGHT, titles: w.titles, stats: w.stats, rules: RULES, prev: null, ...over })

// ---------------------------------------------------------------- floors

test('the people floors: 19 fails, 20 passes', () => {
  assert.match(savingMiss(good({ people7: 19 }), rec(1)), /19 of 20 people/)
  assert.equal(savingMiss(good({ people7: 20 }), rec(1)), null)
  assert.match(savingMiss(good({ savers7: 9, saves7: 9 }), rec(1)), /saved by 9 of 10/)
  assert.equal(savingMiss(good({ savers7: 10, saves7: 10 }), rec(1)), null)
})

test('a one-day burst is not a trend', () => {
  assert.match(savingMiss(good({ daysSeen7: 2 }), rec(1)), /seen on 2 of 3 days/)
  assert.match(savingMiss(good({ saveDays7: 1 }), rec(1)), /saves on 1 of 3 days/)
})

test('one person saving over and over is caught', () => {
  // 15 saves from 10 people: under 70 percent distinct.
  assert.match(savingMiss(good({ saves7: 15, savers7: 10 }), rec(1)), /one-visitor share/)
  assert.equal(savingMiss(good({ saves7: 14, savers7: 10 }), rec(1)), null)
})

test('a title unknown on AniList needs 5 days of its own', () => {
  assert.match(savingMiss(good({ daysSeen7: 4 }), rec(1, { popularity: 100 })), /unknown on AniList/)
  assert.equal(savingMiss(good({ daysSeen7: 5 }), rec(1, { popularity: 100 })), null)
})

test('quick-exit pages and changed minds do not qualify', () => {
  assert.match(savingMiss(good({ entries7: 40, quick7: 30 }), rec(1)), /leave at once/)
  assert.match(savingMiss(good({ unsaves7: 8 }), rec(1)), /removed from lists/)
})

test('the score rewards distinct savers, lifted when saves outrun opens', () => {
  assert.equal(savingScore({ savers7: 10, saves7: 10, opens7: 100 }), 11)
  assert.equal(savingScore({ savers7: 10, saves7: 10, opens7: 5 }), 20, 'the lift is capped at 2x')
})

// ---------------------------------------------------------------- adult filter

test('adult genre, tag and title words are refused', () => {
  assert.equal(adultReason(rec(1, { title: 'Lolicon Saga' }), RULES), "title word 'lolicon'")
  assert.equal(adultReason(rec(1, { title: 'LOLI dayo' }), RULES), "title word 'loli'")
  assert.equal(adultReason(rec(1, { title: 'Clean', synonyms: ['Shota x Shota'] }), RULES), "title word 'shota'")
  assert.equal(adultReason(rec(1, { genres: ['Ecchi'] }), RULES), 'adult genre Ecchi')
  assert.equal(adultReason(rec(1, { tags: ['Nudity'] }), RULES), 'blocked tag Nudity')
  assert.equal(adultReason(rec(1, { isAdult: true }), RULES), 'marked adult on AniList')
  assert.equal(adultReason(rec(1, { title: 'R-18 Nights' }), RULES), "title word 'r-18'")
})

test('a blocked word inside a longer word does not fire', () => {
  // Decided on purpose: "Lolita" and "Essex" are ordinary words.
  assert.equal(adultReason(rec(1, { title: 'Lolita Complex Reversal' }), RULES), null)
  assert.equal(adultReason(rec(1, { title: 'The Essex Serpent' }), RULES), null)
  assert.equal(hasWord('18+ only', '18+'), true)
  assert.equal(hasWord('a118+', '18+'), false)
})

test('"Lolicon Saga" never reaches the homepage, even with the numbers', () => {
  const w = world(8)
  w.titles.set(1, rec(1, { title: 'Lolicon Saga' }))
  w.stats.set(1, good({ savers7: 99, saves7: 99 }))
  const { plan: p, decisions } = plan(w)
  assert.ok(!p.sections.saving.items.some((it) => it.id === 1))
  assert.ok(decisions.some((d) => d.id === 1 && d.action === 'block' && /lolicon/.test(d.reason)))
})

// ---------------------------------------------------------------- block, ban, pin

test('block.json and ban keep a title off; a pin forces one in', () => {
  const w = world(8)
  const rules = { ...RULES, ban: [2], pin: { saving: [7] } }
  w.stats.set(7, good({ savers7: 1, saves7: 1 })) // far below the floor
  const { plan: p } = plan(w, { rules, blocked: new Set([1]) })
  const ids = p.sections.saving.items.map((it) => it.id)
  assert.ok(!ids.includes(1), 'blocked')
  assert.ok(!ids.includes(2), 'banned')
  assert.ok(ids.includes(7), 'pinned')
  assert.equal(p.sections.saving.items[0].id, 7, 'pins lead the shelf')
  assert.equal(p.sections.saving.items.filter((it) => !it.pinned).length, 3, 'the pin did not use the cap')
})

test('a title already in a Trending shelf is never shown twice', () => {
  const w = world(8)
  const { plan: p } = plan(w, { onPage: new Set([8, 7]) })
  const ids = p.sections.saving.items.map((it) => it.id)
  assert.ok(!ids.includes(8) && !ids.includes(7))
  assert.ok(p.rejected.saving.some((r) => r.id === 8 && /Trending/.test(r.reason)))
})

// ---------------------------------------------------------------- brakes

test('the change cap: 5 candidates, cap 3, exactly 3 added, the best first', () => {
  const w = world(5)
  const { plan: p, decisions } = plan(w)
  assert.equal(SECTIONS.saving.cap, 3)
  assert.deepEqual(p.sections.saving.items.map((it) => it.id), [5, 4, 3])
  assert.equal(decisions.filter((d) => d.action === 'add').length, 3)
  assert.deepEqual(p.next.saving.map((it) => it.id), [2, 1])
})

test('the fill floor hides a section and keeps its titles', () => {
  const w = world(5)
  const { plan: p } = plan(w)
  assert.equal(p.sections.saving.enabled, false, '3 titles, floor is 6')
  assert.equal(p.sections.saving.items.length, 3)
  // Two more nights of adds and it is shown.
  const n2 = planHome({ night: addDays(NIGHT, 1), titles: w.titles, stats: w.stats, rules: RULES, prev: p }).plan
  assert.equal(n2.sections.saving.items.length, 5)
  const w8 = world(8)
  const n3 = planHome({ night: addDays(NIGHT, 2), titles: w8.titles, stats: w8.stats, rules: RULES, prev: n2 }).plan
  assert.equal(n3.sections.saving.enabled, true)
  assert.equal(n3.sections.saving.items.length, 8)
})

const prevWith = (items, enabled = true) => ({
  night: addDays(NIGHT, -1),
  sections: { saving: { enabled, items } },
  cooldown: {},
})
const slot = (id, since, over = {}) => ({ id, path: `/manhwa/t-${id}`, since, shown_since: since, pinned: false, ...over })

test('min stay keeps a weak title; a blocked one goes at once', () => {
  const w = world(3, () => ({ savers7: 1, saves7: 1 })) // nobody qualifies tonight
  w.titles.set(3, rec(3, { title: 'Hentai Days' }))
  const prev = prevWith([slot(1, addDays(NIGHT, -1)), slot(2, addDays(NIGHT, -5)), slot(3, addDays(NIGHT, -1))])
  const { plan: p, decisions } = plan(w, { prev })
  const ids = p.sections.saving.items.map((it) => it.id)
  assert.ok(ids.includes(1), 'night 2 of 3: kept')
  assert.ok(!ids.includes(2), 'night 6: dropped, it no longer qualifies')
  assert.ok(!ids.includes(3), 'adult: out, whatever its age')
  assert.ok(decisions.some((d) => d.id === 3 && d.action === 'block'))
})

test('max stay sends a title away, and the cooldown keeps it away', () => {
  const w = world(1)
  const prev = prevWith([slot(1, addDays(NIGHT, -SECTIONS.saving.maxStay))])
  const { plan: p } = plan(w, { prev })
  assert.equal(p.sections.saving.items.length, 0)
  assert.equal(p.cooldown['1'], addDays(NIGHT, SECTIONS.saving.cooldown))
  const next = planHome({ night: addDays(NIGHT, 1), titles: w.titles, stats: w.stats, rules: RULES, prev: p }).plan
  assert.equal(next.sections.saving.items.length, 0, 'still cooling down')
  assert.match(next.rejected.saving[0].reason, /cooling down/)
  const later = planHome({ night: addDays(NIGHT, SECTIONS.saving.cooldown), titles: w.titles, stats: w.stats, rules: RULES, prev: p }).plan
  assert.equal(later.sections.saving.items.length, 1, 'back after the cooldown')
})

test('a section that flips twice in 7 nights is frozen', () => {
  const shown = { ...prevWith(Array.from({ length: 8 }, (_, i) => slot(i + 1, addDays(NIGHT, -10))), true), flips: { saving: [addDays(NIGHT, -3)] } }
  // Tonight only 2 still qualify and the rest are past min stay: it would hide.
  const weak = world(8, (id) => (id > 2 ? { savers7: 1, saves7: 1 } : {}))
  const { plan: p, decisions } = plan(weak, { prev: shown })
  assert.equal(p.sections.saving.enabled, true, 'frozen in its last state')
  assert.ok(p.frozen.saving)
  assert.ok(decisions.some((d) => d.rule === 'flap'))
})

// ---------------------------------------------------------------- closed loop

test('the loop check drops a slot that is shown and never opened', () => {
  const nights = () => DROP.minNights
  const items = [
    { id: 1, shown: 2000, opened: 40 },
    { id: 2, shown: 2000, opened: 36 },
    { id: 3, shown: 2000, opened: 1 },
    { id: 4, shown: 1000, opened: 0 }, // not enough exposure yet
    { id: 5, shown: 2000, opened: 0, pinned: true },
  ]
  const drops = loopDrops(items, nights)
  assert.deepEqual([...drops.keys()], [3])
  assert.equal(drops.get(3), 'shown 2000 times, opened 1 times')
  assert.equal(loopDrops(items, () => DROP.minNights - 1).size, 0, 'too young to judge')
})

test('the loop check reads homepage views and opens from home', () => {
  const w = world(8)
  const since = addDays(NIGHT, -8)
  const prev = prevWith(Array.from({ length: 8 }, (_, i) => slot(i + 1, since)))
  const homeViews = {}
  for (let d = since; d < NIGHT; d = addDays(d, 1)) homeViews[d] = 300
  const fromHome = new Map()
  for (let id = 1; id <= 8; id++) fromHome.set(`/manhwa/t-${id}`, { [since]: id === 8 ? 0 : 20 })
  const { plan: p, decisions } = plan(w, { prev, loop: { homeViews, fromHome } })
  assert.ok(!p.sections.saving.items.some((it) => it.id === 8))
  assert.ok(decisions.some((d) => d.id === 8 && d.rule === 'drop.ctr'))
  assert.equal(p.cooldown['8'], addDays(NIGHT, DROP.cooldown))
})

// ---------------------------------------------------------------- output

test('same input, same output; every reason fits on a phone', () => {
  const w = world(12, (id) => ({ savers7: 20, saves7: 20 + (id % 2) }))
  const a = JSON.stringify(plan(w))
  const b = JSON.stringify(plan(w))
  assert.equal(a, b)
  const { plan: p, decisions } = plan(w)
  for (const it of p.sections.saving.items) assert.ok(it.reason && it.reason.length < 120)
  for (const d of decisions) assert.ok(d.reason.length < 120)
  // Equal scores are ordered by path.
  const tied = p.sections.saving.items.filter((it) => it.score === p.sections.saving.items[0].score).map((it) => it.path)
  assert.deepEqual(tied, [...tied].sort())
})

test('the decisions log keeps 90 nights and replaces a re-run night', () => {
  const old = [
    { night: NIGHT, action: 'skip' },
    { night: addDays(NIGHT, -89), action: 'add' },
    { night: addDays(NIGHT, -90), action: 'add' },
  ]
  const out = mergeDecisions(old, [{ night: NIGHT, action: 'add' }], NIGHT)
  assert.deepEqual(out.map((d) => d.night), [NIGHT, addDays(NIGHT, -89)])
  assert.equal(FLOORS.savers7, 10)
})
