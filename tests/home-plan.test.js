// The homepage planner's rules, with fixed numbers. See src/lib/home-plan.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  planHome, savingMiss, savingScore, adultReason, hasWord, loopDrops, mergeDecisions,
  addDays, SECTIONS, FLOORS, DROP, PRIORITY, PAGE_CHANGE_CAP,
  risingMiss, liftsOf, baseDaysOf, newMiss, newSince, monthMiss, monthScore, exposureOf, startDayOf,
  savingBadge, risingBadge, newBadge, monthBadge, BADGE_MAX,
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
  // The public badge: true distinct savers on a qualifying title, nothing on a pin.
  for (const it of p.sections.saving.items) {
    if (it.pinned) assert.equal(it.badge, '')
    else assert.equal(it.badge, `Saved by ${w.stats.get(it.id).savers7} readers this week`)
  }
})

test('badges are short, honest and only for titles that still qualify', () => {
  assert.equal(savingBadge({ savers7: 14 }), 'Saved by 14 readers this week')
  assert.equal(monthBadge({ opens30: 410 }), 'Opened 410 times this month')
  assert.equal(newBadge({ opens7: 55 }), 'New, opened 55 times this week')
  assert.match(risingBadge({ opens7: 300, opens30: 400 }, { baseDays: 30 }), /^Opened \d+\.\dx its usual this week$/)
  for (const b of [savingBadge({ savers7: 999999 }), monthBadge({ opens30: 1234567 })]) assert.ok(b.length <= BADGE_MAX)
  // Kept only by its minimum stay: no longer at the floor, so no badge.
  const w = world(6)
  const first = plan(w).plan
  w.stats.set(first.sections.saving.items[0].id, good({ savers7: 3, saves7: 3 }))
  const second = plan(w, { prev: first, night: addDays(NIGHT, 1) }).plan
  const kept = second.sections.saving.items.find((it) => it.id === first.sections.saving.items[0].id)
  assert.ok(kept, 'still inside its minimum stay')
  assert.equal(kept.badge, '')
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

// ================================================================ phase 2

// A title rising this week: 30 days of history, a quiet usual, a loud week.
const riser = (over = {}) => ({
  opens1: 30, opens7: 120, opens30: 240, people7: 60, people30: 120, outs7: 10, outs30: 20,
  daysSeen7: 7, entries7: 10, quick7: 1, saves7: 0, savers7: 0, ...over,
})
const CTX = { lastDay: addDays(NIGHT, -1), baseDays: 30, historyStart: '2026-08-01' }

test('rising: lift7 carries the +5 shrink, and 1.8x is the bar', () => {
  // usual week = 7 * 240/30 = 56; (120+5)/(56+5) = 2.05
  assert.equal(liftsOf(riser(), 30).lift7.toFixed(2), '2.05')
  assert.equal(risingMiss(riser(), rec(1), CTX), null)
  // (95+5)/(7*185/30+5) = 100/48.2 = 2.07; still a rise
  assert.equal(risingMiss(riser({ opens7: 95, opens30: 185 }), rec(1), CTX), null)
  // A title opened the same every week is not rising.
  assert.match(risingMiss(riser({ opens7: 70, opens30: 300, opens1: 10 }), rec(1), CTX), /its usual, needs 1.8x/)
  assert.match(risingMiss(riser({ opens7: 29, opens30: 40, people7: 20 }), rec(1), CTX), /29 of 30 times/)
})

test('rising: a spike yesterday on a page with traffic also counts', () => {
  // lift7 = (70+5)/(7*300/30+5) = 1.0, but yesterday was 40 against a usual 10.
  const s = riser({ opens7: 70, opens30: 300, opens1: 40 })
  assert.ok(liftsOf(s, 30).lift1 >= 2.5)
  assert.equal(risingMiss(s, rec(1), CTX), null)
  assert.match(risingMiss({ ...s, opens7: 59 }, rec(1), CTX), /its usual/, 'a spike needs 60 opens in the week')
})

test('rising: no history before this week goes to New, never Rising', () => {
  assert.equal(risingMiss(riser({ opens30: 120 }), rec(1), CTX), 'no history before this week')
})

test('rising: a young counter divides by the days it really has', () => {
  assert.equal(baseDaysOf('2026-09-15', '2026-09-27'), 12)
  assert.equal(baseDaysOf('2026-08-01', '2026-09-27'), 30)
  assert.equal(baseDaysOf(null, '2026-09-27'), 30)
  // 12 days of 20 opens a day, a flat week of 140: not a rise over 12 days,
  // but it would look like 2.2x if the 240 were spread over 30.
  const flat = riser({ opens7: 140, opens30: 240, opens1: 20 })
  assert.match(risingMiss(flat, rec(1), { ...CTX, baseDays: 12 }), /needs 1.8x/)
  assert.equal(risingMiss(flat, rec(1), CTX), null)
})

test('rising and new: one person reloading a page is caught', () => {
  assert.match(risingMiss(riser({ opens7: 200, people7: 60 }), rec(1), CTX), /200 opens from 60 people/)
  assert.match(risingMiss(riser({ saves7: 6, savers7: 2 }), rec(1), CTX), /6 saves from 2 people/)
  // Two saves by one person is too small to call.
  assert.equal(risingMiss(riser({ saves7: 2, savers7: 1 }), rec(1), CTX), null)
  // A one-day burst is not a trend, in every section.
  assert.match(risingMiss(riser({ daysSeen7: 2 }), rec(1), CTX), /seen on 2 of 3 days/)
})

test('new: a first day is believed only well after the counter began', () => {
  const s = riser({ opens30: 120, firstDay: '2026-09-20' })
  assert.equal(newSince(s, rec(1), CTX), '2026-09-20')
  // The counter began 15 Sep: every old page got a first day around then.
  assert.equal(newSince(s, rec(1), { ...CTX, historyStart: '2026-09-15' }), null)
  assert.equal(newSince(s, rec(1), { ...CTX, historyStart: null }), null)
  // A start date on AniList in the last 120 days is always believed.
  assert.equal(startDayOf([2026, 7, null]), '2026-07-01')
  assert.equal(startDayOf([2026, null, null]), null)
  assert.equal(newSince({}, rec(1, { startDate: [2026, 7, 4] }), { ...CTX, historyStart: null }), '2026-07-04')
  assert.equal(newSince({}, rec(1, { startDate: [2025, 1, 4] }), CTX), null)
  assert.equal(newSince({}, rec(1, { startDate: [2027, 1, 4] }), CTX), null, 'not started yet')
})

test('new: floors of 30 opens and 20 people', () => {
  const s = riser({ opens30: 120, firstDay: '2026-09-20' })
  assert.equal(newMiss(s, rec(1), CTX), null)
  assert.match(newMiss({ ...s, opens7: 29 }, rec(1), CTX), /29 of 30 times/)
  assert.match(newMiss({ ...s, people7: 19 }, rec(1), CTX), /19 of 20 people/)
  assert.match(newMiss(riser({ firstDay: '2026-07-01' }), rec(1), CTX), /not new/)
})

test('most opened: 150 opens, 60 people in 30 days, 2 in 100 go on', () => {
  const s = riser({ opens30: 300, people30: 120, outs30: 12 })
  assert.equal(monthMiss(s, rec(1)), null)
  assert.match(monthMiss({ ...s, people30: 59 }, rec(1)), /59 of 60 people this month/)
  assert.match(monthMiss({ ...s, opens30: 149, people30: 60 }, rec(1)), /149 of 150 times/)
  assert.match(monthMiss({ ...s, outs30: 5 }, rec(1)), /1.7% went on to read or watch, needs 2%/)
  assert.equal(monthScore(s), 162, '300 * (0.5 + 0.04)')
})

// A world where titles 1-4 rise, 5-6 are new, 7-14 are steady monthly
// titles, and title 1 is also saved by many people.
function mixed() {
  const titles = new Map()
  const stats = new Map()
  for (let id = 1; id <= 14; id++) titles.set(id, rec(id))
  for (let id = 1; id <= 4; id++) stats.set(id, riser({ opens7: 120 + id }))
  for (let id = 5; id <= 6; id++) stats.set(id, riser({ opens30: 120 + id, opens7: 120 + id, firstDay: '2026-09-20' }))
  for (let id = 7; id <= 14; id++) {
    stats.set(id, riser({ opens7: 60, opens30: 300 + id, people30: 150, outs30: 30, opens1: 8 }))
  }
  stats.set(1, { ...stats.get(1), saves7: 14, savers7: 12, saveDays7: 4 })
  return { titles, stats }
}
const planMixed = (over = {}) => {
  const w = mixed()
  return planHome({ night: NIGHT, titles: w.titles, stats: w.stats, rules: RULES, prev: null, historyStart: '2026-08-01', ...over })
}

test('every section fills from its own rule, rising first', () => {
  const { plan: p } = planMixed()
  assert.deepEqual(PRIORITY, ['rising', 'new', 'saving', 'month'])
  assert.deepEqual(Object.keys(p.sections), ['rising', 'saving', 'new', 'month'])
  assert.deepEqual(p.sections.rising.items.map((it) => it.id), [4, 3, 2, 1])
  assert.deepEqual(p.sections.new.items.map((it) => it.id).sort(), [5, 6])
  assert.ok(p.sections.month.items.length > 0)
  assert.ok(p.sections.rising.items.every((it) => it.reason.length < 120))
})

test('a title sits in one section only, by priority', () => {
  const { plan: p } = planMixed()
  // Title 1 rises and is saved by 12 people: it goes to Rising only.
  assert.ok(p.sections.rising.items.some((it) => it.id === 1))
  assert.ok(!p.sections.saving.items.some((it) => it.id === 1))
  const all = Object.values(p.sections).flatMap((s) => s.items.map((it) => it.id))
  assert.equal(new Set(all).size, all.length, 'no id twice across sections')
})

test('the page-wide cap: at most 8 new titles a night across all sections', () => {
  const { plan: p, decisions } = planMixed()
  const adds = decisions.filter((d) => d.action === 'add')
  assert.equal(PAGE_CHANGE_CAP, 8)
  assert.equal(adds.length, 8, 'rising 4 + new 2 + month 2')
  assert.equal(p.sections.month.items.length, 2, 'month got what was left of the page cap')
  assert.ok(p.next.month.length > 0, 'the rest wait for another night')
})

test('no title from Trending, airing or coming soon in any section', () => {
  const { plan: p } = planMixed({ onPage: new Set([4, 5, 7]) })
  const all = Object.values(p.sections).flatMap((s) => s.items.map((it) => it.id))
  for (const id of [4, 5, 7]) assert.ok(!all.includes(id))
})

test('adult, block.json, ban and pin hold in every section', () => {
  const w = mixed()
  w.titles.set(2, rec(2, { title: 'Hentai Rising' }))
  w.titles.set(8, rec(8, { tags: ['Nudity'] }))
  const rules = { ...RULES, ban: [3], pin: { month: [13] } }
  const { plan: p, decisions } = planHome({
    night: NIGHT, titles: w.titles, stats: w.stats, rules, prev: null, historyStart: '2026-08-01', blocked: new Set([5]),
  })
  const all = Object.values(p.sections).flatMap((s) => s.items.map((it) => it.id))
  for (const id of [2, 3, 5, 8]) assert.ok(!all.includes(id), `id ${id} kept off`)
  assert.equal(p.sections.month.items[0].id, 13, 'the pin leads its shelf')
  assert.ok(p.sections.month.items[0].pinned)
  // A blocked title is logged once, not once per section.
  assert.equal(decisions.filter((d) => d.id === 2 && d.action === 'block').length, 1)
})

test('kept titles stay in their shelf before any new title is placed', () => {
  // Title 1 has been in Saving for 2 nights; tonight it also rises. It stays
  // in Saving rather than hopping to Rising.
  const prev = {
    night: addDays(NIGHT, -1),
    sections: { saving: { enabled: false, items: [slot(1, addDays(NIGHT, -2))] } },
    cooldown: {},
  }
  const { plan: p } = planMixed({ prev })
  assert.ok(p.sections.saving.items.some((it) => it.id === 1))
  assert.ok(!p.sections.rising.items.some((it) => it.id === 1))
})

test('new titles leave after 45 nights and do not come back as new', () => {
  const prev = { night: addDays(NIGHT, -1), sections: { new: { enabled: true, items: [slot(5, addDays(NIGHT, -45))] } }, cooldown: {} }
  const { plan: p } = planMixed({ prev })
  assert.ok(!p.sections.new.items.some((it) => it.id === 5))
  assert.equal(p.cooldown['5'], addDays(NIGHT, SECTIONS.new.cooldown))
})

// ---------------------------------------------------------------- closed loop, phase 2

test("exposure uses the homepage's own seen and click numbers when a day has them", () => {
  const since = addDays(NIGHT, -3)
  const item = { id: 7, path: '/manhwa/t-7', shown_since: since }
  const loop = {
    homeViews: { [since]: 1000, [addDays(since, 1)]: 1000, [addDays(since, 2)]: 1000 },
    fromHome: new Map([['/manhwa/t-7', { [since]: 50, [addDays(since, 1)]: 50, [addDays(since, 2)]: 50 }]]),
    // The first day predates the homepage events: it falls back to views.
    seen: { [addDays(since, 1)]: { month: 400, rising: 900 }, [addDays(since, 2)]: { rising: 100 } },
    clicks: new Map([['month:7', { [addDays(since, 1)]: 6 }]]),
  }
  assert.deepEqual(exposureOf(item, 'month', loop, addDays(NIGHT, -1)), { shown: 1400, opened: 56 })
  assert.deepEqual(exposureOf({ ...item, shown_since: null }, 'month', loop, addDays(NIGHT, -1)), { shown: 0, opened: 0 })
})

test('the drop rule: after 7 nights and 1,500 exposures, under 25% of the median goes', () => {
  const since = addDays(NIGHT, -8)
  const items = Array.from({ length: 8 }, (_, i) => slot(i + 7, since))
  const prev = { night: addDays(NIGHT, -1), sections: { month: { enabled: true, items } }, cooldown: {} }
  const seen = {}
  const clicks = new Map()
  for (let d = since; d < NIGHT; d = addDays(d, 1)) seen[d] = { month: 250 }
  for (let id = 7; id <= 14; id++) clicks.set(`month:${id}`, { [since]: id === 14 ? 1 : 30 })
  const loop = { homeViews: {}, fromHome: new Map(), seen, clicks }
  const { plan: p, decisions } = planMixed({ prev, loop })
  assert.ok(!p.sections.month.items.some((it) => it.id === 14), 'shown 2000 times, opened once')
  assert.ok(decisions.some((d) => d.id === 14 && d.rule === 'drop.ctr' && /shown 2000 times, opened 1 times/.test(d.reason)))
  assert.equal(p.cooldown['14'], addDays(NIGHT, DROP.cooldown))
  // The same slots, younger than 7 nights, are not judged yet.
  const young = {
    ...prev,
    sections: { month: { enabled: true, items: items.map((it) => ({ ...it, since: addDays(NIGHT, -5), shown_since: since })) } },
  }
  const { plan: q } = planMixed({ prev: young, loop })
  assert.ok(q.sections.month.items.some((it) => it.id === 14))
})

test('phase 2 planning is deterministic', () => {
  assert.equal(JSON.stringify(planMixed()), JSON.stringify(planMixed()))
})
