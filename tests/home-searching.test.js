// "People are searching for" (called "Hot this week" on the homepage): the
// section rule, alone and inside the planner with every brake the other
// shelves have. See src/lib/home-searching.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planHome, FLOORS, PRIORITY, SECTIONS, PAGE_CHANGE_CAP, searchHistoryDaysOf } from '../src/lib/home-plan.mjs'
import {
  searchingMiss, searchingScore, searchingReason, searchingBadge, searchLift, SEARCHING,
  SEARCH_MODES, searchModeOf,
} from '../src/lib/home-searching.mjs'
import { HOME_SECTIONS } from '../src/lib/home-sections.js'

const RULES = JSON.parse(readFileSync(new URL('../data/home-rules.json', import.meta.url), 'utf8'))
const NIGHT = '2026-09-27'
const ctx = { searchBaseDays: 30, floors: FLOORS }

// Found on Google by 34 people this week, far above a quiet usual.
const found = (over = {}) => ({
  g1: 6, g7: 40, g30: 52, gPeople7: 34, gDays7: 5, gGoogle7: 38,
  s7: 0, sPeople7: 0, sDays7: 0, entries7: 30, quick7: 6, ...over,
})
// Searched on our own box by 6 people, no Google at all.
const searched = (over = {}) => ({ g7: 0, g30: 0, gPeople7: 0, gDays7: 0, s7: 7, sPeople7: 6, sDays7: 4, ...over })
const rec = (id, over = {}) => ({ id, title: `Title ${id}`, path: `/manga/t-${id}`, genres: ['Drama'], tags: [], popularity: 5000, ...over })

test('a title found on Google well above its usual qualifies', () => {
  assert.equal(searchingMiss(found(), rec(1), ctx), null)
  assert.ok(searchLift(found(), 30) > SEARCHING.lift7)
  assert.ok(searchingScore(found(), ctx) > 0)
})

test('the search-engine floors: people, a 3-day spread, one visitor, the rise', () => {
  assert.match(searchingMiss(found({ gPeople7: 9, g7: 12 }), rec(1), ctx), /found on search by 9 of 10 people/)
  assert.match(searchingMiss(found({ gDays7: 2 }), rec(1), ctx), /on 2 of 3 days/)
  assert.match(searchingMiss(found({ g7: 120 }), rec(1), ctx), /one-visitor share: 120 arrivals from 34 people/)
  // Always found this often: 40 a week against a usual of 40 a week is no rise.
  assert.match(searchingMiss(found({ g30: 170 }), rec(1), ctx), /its usual on search, needs 1.5x/)
})

test('the usual is worked out over the days the table really has', () => {
  // 40 this week, 52 over 12 real days: a usual week of ~30, a real rise only
  // if the 12 days are not stretched over 30.
  const s = found()
  assert.ok(searchLift(s, 30) > searchLift(s, 12))
  assert.ok(searchLift(s, 7) < 1.2, 'one week of history has no usual to rise from')
})

test('our own search box is enough on its own, with its own floors', () => {
  assert.equal(searchingMiss(searched(), rec(1), ctx), null)
  assert.match(searchingMiss(searched({ sPeople7: 4, s7: 4 }), rec(1), ctx), /searched here by 4 of 5 people/)
  assert.match(searchingMiss(searched({ sDays7: 2 }), rec(1), ctx), /searched here on 2 of 3 days/)
  assert.match(searchingMiss(searched({ s7: 30 }), rec(1), ctx), /one-visitor share: 30 searches from 6 people/)
  assert.equal(searchingScore(searched(), ctx), SEARCHING.siteWeight * 6)
})

test('the shared brakes still hold: unknown titles and quick-exit pages', () => {
  assert.match(searchingMiss(found({ gDays7: 3 }), rec(1, { popularity: 10 }), ctx), /unknown on AniList/)
  assert.equal(searchingMiss(found({ gDays7: 5 }), rec(1, { popularity: 10 }), ctx), null)
  assert.match(searchingMiss(found({ entries7: 40, quick7: 35 }), rec(1), ctx), /leave at once/)
})

test('the admin reason names both signals; the public badge names neither', () => {
  const s = found({ sPeople7: 2, s7: 2, sDays7: 1 })
  assert.match(searchingReason(s, ctx), /^Found on Google by 34 people this week \(40 arrivals, \d\.\dx usual\), searched here by 2$/)
  // Mostly Bing and Yandex: the admin line says "search", not Google.
  assert.match(searchingReason(found({ gGoogle7: 10 }), ctx), /^Found on search by 34 people/)
  // On the cover: the same plain words whichever side put it there (owner's
  // call): no engine, no number.
  for (const one of [s, found({ gGoogle7: 10 }), searched(), found({ gPeople7: 1234, g7: 1300, g30: 1400 })]) {
    assert.equal(searchingBadge(one, ctx), 'Hot this week')
  }
  // A title kept by its minimum stay but under the floor gets no badge.
  assert.equal(searchingBadge(found({ gPeople7: 3 }), ctx), '')
  assert.equal(SECTIONS.searching.title, 'Hot this week')
  assert.doesNotMatch(SECTIONS.searching.why, /google|\d/i)
})

// ---------------------------------------------------------------- inside the planner

function world(n, over = () => ({})) {
  const titles = new Map()
  const stats = new Map()
  for (let id = 1; id <= n; id++) {
    titles.set(id, rec(id))
    stats.set(id, found({ gPeople7: 20 + id, g7: 25 + id, gGoogle7: 25 + id, ...over(id) }))
  }
  return { titles, stats }
}
const plan = (w, over = {}) =>
  planHome({ night: NIGHT, titles: w.titles, stats: w.stats, rules: RULES, prev: null, searchHistoryStart: '2026-08-01', ...over })

test('the section is known everywhere: sections, priority, homepage keys', () => {
  assert.equal(PRIORITY[1], 'searching')
  assert.equal(HOME_SECTIONS.at(-1), 'searching', 'a new shelf key goes at the end')
})

test('the planner fills the shelf best first, a few a night', () => {
  const w = world(10)
  const { plan: p, decisions } = plan(w)
  const items = p.sections.searching.items
  assert.equal(items.length, SECTIONS.searching.cap)
  assert.deepEqual(items.map((it) => it.id), [10, 9, 8])
  assert.equal(items[0].badge, 'Hot this week')
  assert.match(items[0].reason, /searched here by 0/)
  assert.equal(p.next.searching.length, 5)
  assert.ok(decisions.some((d) => d.section === 'searching' && d.action === 'add'))
  assert.equal(p.sections.searching.enabled, false, '3 is under the floor of 4 on the first night')
})

test('adult, blocked, banned, Trending and cooling titles are kept off', () => {
  const w = world(8)
  w.titles.set(1, rec(1, { isAdult: true }))
  w.titles.set(2, rec(2, { title: 'Hentai Days' }))
  const { plan: p } = plan(w, {
    blocked: new Set([3]),
    rules: { ...RULES, ban: [4] },
    onPage: new Set([5]),
    prev: { night: '2026-09-26', sections: {}, cooldown: { 6: '2026-10-01' } },
  })
  const shown = new Set([...p.sections.searching.items, ...p.next.searching].map((it) => it.id))
  for (const id of [1, 2, 3, 4, 5, 6]) assert.ok(!shown.has(id), `title ${id} is kept off`)
  assert.deepEqual([...shown].sort(), [7, 8])
  const why = new Map(p.rejected.searching.map((r) => [r.id, r.reason]))
  assert.match(why.get(1), /marked adult/)
  assert.match(why.get(6), /cooling down/)
})

test('a title Rising already holds is not shown twice', () => {
  const w = world(6)
  // Title 6 is also rising on opens, and Rising goes first.
  w.stats.set(6, {
    ...w.stats.get(6), opens1: 60, opens7: 300, opens30: 360, people7: 120, daysSeen7: 7, entries7: 30, quick7: 5,
  })
  const { plan: p } = plan(w, { historyStart: '2026-08-01' })
  const rising = p.sections.rising.items.map((it) => it.id)
  const searching = p.sections.searching.items.map((it) => it.id)
  assert.ok(rising.includes(6))
  assert.ok(!searching.includes(6))
})

test('the whole page still changes by at most the nightly cap', () => {
  const w = world(40, (id) => ({
    savers7: 20, saves7: 20, saveDays7: 5, opens1: 60, opens7: 300, opens30: 360, people7: 80, daysSeen7: 7,
    unsaves7: 0, outs30: 50, people30: 200, entries7: 30, quick7: 5, gPeople7: 10 + id,
  }))
  const { decisions } = plan(w, { historyStart: '2026-08-01' })
  assert.ok(decisions.filter((d) => d.action === 'add').length <= PAGE_CHANGE_CAP)
})

test('the shelf stays for its minimum nights, then leaves when the searching stops', () => {
  const w = world(6)
  const first = plan(w).plan
  const ids = first.sections.searching.items.map((it) => it.id)
  // The next night nobody searches for them any more.
  for (const id of ids) w.stats.set(id, found({ gPeople7: 0, g7: 0 }))
  const night2 = planHome({ night: '2026-09-28', titles: w.titles, stats: w.stats, rules: RULES, prev: first, searchHistoryStart: '2026-08-01' })
  assert.deepEqual(night2.plan.sections.searching.items.filter((it) => ids.includes(it.id)).map((it) => it.badge), ['', '', ''], 'kept, but no badge')
  const night5 = planHome({ night: '2026-10-01', titles: w.titles, stats: w.stats, rules: RULES, prev: night2.plan, searchHistoryStart: '2026-08-01' })
  const left = night5.plan.sections.searching.items.map((it) => it.id)
  for (const id of ids) assert.ok(!left.includes(id), `title ${id} left after its minimum stay`)
})

// ---------------------------------------------------------------- young data: volume mode

const young = { ...ctx, searchMode: 'volume' }
// Found by 25 people this week, as often as ever: no rise at all.
const steady = (over = {}) => found({ g7: 30, g30: 130, gPeople7: 25, gGoogle7: 30, ...over })

test('the mode follows the days of search history: volume under 28, rise from 28', () => {
  assert.equal(searchHistoryDaysOf(null, NIGHT), 0)
  assert.equal(searchHistoryDaysOf('2026-09-27', NIGHT), 0, 'tonight is not a closed day yet')
  assert.equal(searchHistoryDaysOf('2026-09-19', NIGHT), 8)
  assert.equal(searchModeOf(0), 'volume')
  assert.equal(searchModeOf(27), 'volume')
  assert.equal(searchModeOf(28), 'lift')
  assert.equal(SEARCHING.matureDays, 28)
  assert.equal(SEARCH_MODES.volume, 'most searched (young data)')
  assert.equal(SEARCH_MODES.lift, 'rising')
})

test('volume mode ranks by people, with no rise needed', () => {
  assert.match(searchingMiss(steady(), rec(1), ctx), /its usual on search/, 'the rise rule keeps it off')
  assert.equal(searchingMiss(steady(), rec(1), young), null, 'volume mode takes it')
  // Distinct people from search engines plus distinct people on our own box.
  assert.equal(searchingScore(steady(), young), 25)
  assert.equal(searchingScore(steady({ s7: 7, sPeople7: 6, sDays7: 4 }), young), 31)
  assert.equal(searchingScore(searched(), young), 6)
  assert.equal(searchingReason(steady(), young), 'Found on Google by 25 people this week (30 arrivals), searched here by 0')
  assert.equal(searchingBadge(steady(), young), 'Hot this week')
})

test('volume mode keeps every floor and brake', () => {
  assert.match(searchingMiss(steady({ gPeople7: 9, g7: 12 }), rec(1), young), /found on search by 9 of 10 people/)
  assert.match(searchingMiss(steady({ gDays7: 2 }), rec(1), young), /on 2 of 3 days/)
  assert.match(searchingMiss(steady({ g7: 120 }), rec(1), young), /one-visitor share: 120 arrivals from 25 people/)
  assert.match(searchingMiss(searched({ sPeople7: 4, s7: 4 }), rec(1), young), /searched here by 4 of 5 people/)
  assert.match(searchingMiss(steady({ gDays7: 3 }), rec(1, { popularity: 10 }), young), /unknown on AniList/)
  assert.match(searchingMiss(steady({ entries7: 40, quick7: 35 }), rec(1), young), /leave at once/)
  assert.equal(searchingScore(steady({ gDays7: 2 }), young), 0)
})

test('the planner runs volume mode on young data and logs it', () => {
  const w = world(6, (id) => ({ g30: 400 + id, g7: 25 + id }))
  const { plan: p, decisions } = plan(w, { searchHistoryStart: '2026-09-19' })
  assert.equal(p.modes.searching, 'volume')
  const line = decisions.find((d) => d.section === 'searching' && d.action === 'mode')
  assert.equal(line.rule, 'searching.mode')
  assert.equal(line.reason, 'mode: most searched (young data), 8 days of search history')
  assert.deepEqual(p.sections.searching.items.map((it) => it.id), [6, 5, 4], 'most people first, within the nightly cap')
  assert.doesNotMatch(p.sections.searching.items[0].reason, /usual/)
})

test('volume mode still keeps adult, blocked, banned, Trending and Rising titles off', () => {
  const w = world(9, (id) => ({ g30: 400 + id }))
  w.titles.set(1, rec(1, { isAdult: true }))
  w.titles.set(2, rec(2, { title: 'Hentai Days' }))
  w.stats.set(6, {
    ...w.stats.get(6), opens1: 60, opens7: 300, opens30: 360, people7: 120, daysSeen7: 7, entries7: 30, quick7: 5,
  })
  const { plan: p } = plan(w, {
    searchHistoryStart: '2026-09-19',
    historyStart: '2026-08-01',
    blocked: new Set([3]),
    rules: { ...RULES, ban: [4] },
    onPage: new Set([5]),
  })
  assert.ok(p.sections.rising.items.some((it) => it.id === 6))
  const shown = new Set([...p.sections.searching.items, ...p.next.searching].map((it) => it.id))
  for (const id of [1, 2, 3, 4, 5, 6]) assert.ok(!shown.has(id), `title ${id} is kept off`)
})

test('from 28 days of history the planner switches back to the rise by itself', () => {
  const w = world(6, (id) => ({ g30: 400 + id, g7: 25 + id }))
  // 30 Aug to 26 Sep is 28 closed days.
  const { plan: p, decisions } = plan(w, { searchHistoryStart: '2026-08-30' })
  assert.equal(p.modes.searching, 'lift')
  assert.match(decisions.find((d) => d.action === 'mode').reason, /^mode: rising, 28 days/)
  assert.equal(p.sections.searching.items.length, 0, 'a steady title is not news once there is a usual')
  assert.match(p.rejected.searching[0].reason, /its usual on search/)
  // The day before, 27 days: still volume.
  assert.equal(plan(w, { searchHistoryStart: '2026-08-31' }).plan.modes.searching, 'volume')
})
