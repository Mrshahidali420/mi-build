/**
 * The homepage planner's rules. Pure: no fetch, no disk, no clock. The night
 * and every number are passed in, so the same input always gives the same
 * plan, and every rule below is tested in tests/home-plan.test.js.
 *
 * Why it exists: the homepage is the strongest page on the site, and until
 * now every shelf on it was picked by AniList popularity or by hand. Readers
 * already tell us what they care about (they open titles, save them, come
 * back to them), so a few shelves can follow them. The danger is the other
 * side: a handful of people, one person clicking over and over, or a title
 * nobody should see on a front page. So every rule here is a floor or a brake
 * first, and a score second.
 *
 * scripts/plan-home.mjs reads the numbers from D1 and the catalog from disk,
 * calls planHome(), and writes data/home-auto.json and data/home-decisions.json.
 * The four sections and their numbers are in tasks/auto-homepage-plan.md.
 */

// Each section's size and brakes, in the order the homepage draws them.
// slots: how many covers at most. floor: fewer than this and the section is
// not drawn at all (a shelf of two looks broken). cap: new titles per night,
// so the page never churns. minStay / maxStay / cooldown: nights. A title
// stays at least minStay nights once added, leaves after maxStay, and cannot
// come back for cooldown nights after that.
export const SECTIONS = {
  rising: {
    title: 'Rising this week',
    why: 'Titles readers are opening more often than usual this week.',
    slots: 12,
    floor: 6,
    cap: 4,
    minStay: 3,
    maxStay: 14,
    cooldown: 7,
  },
  saving: {
    title: 'Readers are saving',
    why: 'Titles readers added to their lists this week.',
    slots: 12,
    floor: 6,
    cap: 3,
    minStay: 3,
    maxStay: 21,
    cooldown: 7,
  },
  new: {
    title: 'New and noticed',
    why: 'Recent titles readers have started to open.',
    slots: 6,
    floor: 3,
    cap: 2,
    minStay: 3,
    // "New" wears off: after 45 nights a title leaves, and the long cooldown
    // stops it coming back as new a second time.
    maxStay: 45,
    cooldown: 90,
  },
  month: {
    title: 'Most opened this month',
    why: 'Titles readers kept coming back to over the last month.',
    slots: 12,
    floor: 8,
    cap: 2,
    minStay: 7,
    maxStay: 30,
    cooldown: 7,
  },
}

// When a title qualifies for more than one section it goes to the first of
// these. Rising and New are the rarer, more useful statements; Most opened is
// the slow one and takes what is left.
export const PRIORITY = ['rising', 'new', 'saving', 'month']

// Across the whole page, however many sections there are, at most this many
// titles change in one night. Google's September 2026 spam update is looking
// hard at pages that rewrite themselves; a calm page is the safe page.
export const PAGE_CHANGE_CAP = 8

export const FLOORS = {
  // Distinct people who opened the title's page this week (per-day distinct,
  // summed). Below this the title is simply not known well enough.
  people7: 20,
  // The same for the month section, over 30 days.
  people30: 60,
  // Days out of 7 the title had a row at all. One loud day is not a trend.
  daysSeen7: 3,
  // Distinct people who saved it this week. The heart of the Saving section.
  savers7: 10,
  // Days out of 7 with at least one save.
  saveDays7: 3,
  // When fewer than 70 percent of saves come from distinct people, one person
  // is clicking save over and over. 1 / 0.7 = 1.43.
  oneVisitorRatio: 1.43,
  // Two saves by one person is someone removing and re-adding, not a push.
  // The saves check starts to matter from three.
  oneVisitorMinSaves: 3,
  // The same idea for opens: a real reader opens a title page once or twice
  // a day. Three times the people count means someone is reloading it.
  opensPerPerson: 3,
  // A title nobody on AniList knows can only be placed by our own numbers, so
  // it must have shown up on 5 of the last 7 days.
  popularityAnchor: 500,
  anchorDays: 5,
  // A page most people leave at once is not one to send more people to.
  // The same 0.7 quickExitHint() uses on /my-admin.
  quickExitShare: 0.7,
  quickExitMinEntries: 20,
  // More removes than half the adds: readers are changing their minds.
  unsaveShare: 0.5,
}

// Rising: this week against the title's own usual week. The +5 and +3 shrink
// small numbers, so 3 opens against a usual 1 is not a "3x rise".
export const RISING = { minOpens7: 30, lift7: 1.8, spikeOpens7: 60, lift1: 2.5, shrink7: 5, shrink1: 3 }

// New: a page first counted in the last 30 days, or a title that started in
// the last 120. historyMargin: the counter only began on one day, and every
// page that existed then got that day as its "first day". A first day is only
// believed when it is this many days after the counter began.
export const NEW = { firstSeenDays: 30, startDays: 120, minOpens7: 30, historyMargin: 14 }

// Most opened: a steady month, and people who go on to read or watch (2 in
// 100, the floor entryPageHint() already uses).
export const MONTH = { minOpens30: 150, minHandoff: 0.02 }

// The closed-loop check. A slot that has been on screen long enough and is
// hardly ever opened from the homepage is giving its space to nobody.
export const DROP = {
  minNights: 7,
  minExposure: 1500,
  shareOfMedian: 0.25,
  minRate: 0.001,
  cooldown: 14,
}

// A section that shows and hides twice in this many nights is frozen in its
// last state for the same number of nights, so a floor that sits right on
// the line does not make the page blink.
export const FLAP_WINDOW = 7

const MAX_REASON = 119

// ------------------------------------------------------------------ dates

/** 'YYYY-MM-DD' shifted by whole days. */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

/** Whole days from a to b ('YYYY-MM-DD'). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

/** AniList's [year, month, day] as 'YYYY-MM-DD', or null without a month. */
export function startDayOf(start) {
  if (!Array.isArray(start)) return null
  const [y, m, d] = start
  if (!y || !m) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d || 1)}`
}

/**
 * How many days the 30-day baseline really covers. The counter began on one
 * day; until it has run 30 days, dividing by 30 would make every title look
 * like it is rising.
 */
export function baseDaysOf(historyStart, night) {
  const last = addDays(night, -1)
  const from = addDays(night, -30)
  if (!historyStart || historyStart <= from) return 30
  return Math.max(1, Math.min(30, daysBetween(historyStart, last) + 1))
}

// ------------------------------------------------------------------ safety

const lower = (s) => String(s || '').toLowerCase()

/**
 * Does `text` hold `word` as a word of its own? Letters and digits on either
 * side mean it is part of a longer word: "loli" does not match "Lolita", on
 * purpose (a word list that fires on ordinary words gets switched off).
 * Anything else counts as a boundary, so "r-18" and "18+" work too.
 */
export function hasWord(text, word) {
  const t = lower(text)
  const w = lower(word)
  if (!w) return false
  let at = t.indexOf(w)
  while (at !== -1) {
    const before = at === 0 ? '' : t[at - 1]
    const after = t[at + w.length] || ''
    const edge = (ch) => !ch || !/[\p{L}\p{N}]/u.test(ch)
    if (edge(before) && edge(after)) return true
    at = t.indexOf(w, at + 1)
  }
  return false
}

/**
 * Why a title must never be on the homepage, or null. Checks what the
 * catalog says (isAdult, genres, tags) and every name it goes by, because a
 * title can be tagged clean and still be called something no front page
 * should show.
 */
export function adultReason(title, rules = {}) {
  if (!title) return null
  if (title.isAdult === true) return 'marked adult on AniList'
  const genres = new Set((rules.adultGenres || []).map(lower))
  const genre = (title.genres || []).find((g) => genres.has(lower(g)))
  if (genre) return `adult genre ${genre}`
  const tags = new Set((rules.tagBlock || []).map(lower))
  const tag = (title.tags || []).map((t) => (typeof t === 'string' ? t : t && t.name)).find((t) => tags.has(lower(t)))
  if (tag) return `blocked tag ${tag}`
  const names = [title.title, title.titleRomaji, title.titleEnglish, ...(title.synonyms || [])]
  for (const word of rules.titleWordBlock || []) {
    if (names.some((name) => hasWord(name, word))) return `title word '${lower(word)}'`
  }
  return null
}

/**
 * The hard "no": reasons that remove a title at once, even one still inside
 * its minimum stay. Safety beats stability.
 */
export function safetyReason(id, title, ctx) {
  if (!title) return 'not in the catalog'
  if (ctx.blocked.has(id)) return 'in data/block.json'
  if (ctx.banned.has(id)) return 'banned in data/home-rules.json'
  return adultReason(title, ctx.rules)
}

// ------------------------------------------------------------------ shared floors

/**
 * The floors every section shares (plan 4.1), for a 7-day or a 30-day
 * section. `opens` turns on the reload check, which only the sections that
 * rank by opens need; Saving already counts true distinct savers.
 */
function sharedMiss(s, title, { win = 7, opens = false } = {}) {
  if (win === 30) {
    if ((s.people30 || 0) < FLOORS.people30) return `opened by ${s.people30 || 0} of ${FLOORS.people30} people this month`
  } else if ((s.people7 || 0) < FLOORS.people7) {
    return `opened by ${s.people7 || 0} of ${FLOORS.people7} people`
  }
  if ((s.daysSeen7 || 0) < FLOORS.daysSeen7) return `seen on ${s.daysSeen7 || 0} of ${FLOORS.daysSeen7} days`
  const saves = s.saves7 || 0
  if (saves >= FLOORS.oneVisitorMinSaves && saves > FLOORS.oneVisitorRatio * (s.savers7 || 0)) {
    return `one-visitor share: ${saves} saves from ${s.savers7 || 0} people`
  }
  if (opens) {
    const n = win === 30 ? s.opens30 || 0 : s.opens7 || 0
    const people = win === 30 ? s.people30 || 0 : s.people7 || 0
    if (n > FLOORS.opensPerPerson * people) return `one-visitor share: ${n} opens from ${people} people`
  }
  if ((title?.popularity || 0) < FLOORS.popularityAnchor && (s.daysSeen7 || 0) < FLOORS.anchorDays) {
    return `unknown on AniList and seen on ${s.daysSeen7 || 0} of ${FLOORS.anchorDays} days`
  }
  const entries = s.entries7 || 0
  if (entries >= FLOORS.quickExitMinEntries && (s.quick7 || 0) / entries > FLOORS.quickExitShare) {
    return 'most visits leave at once'
  }
  return null
}

const cut = (text) => (text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text)
const round2 = (n) => Math.round(n * 100) / 100

// ------------------------------------------------------------------ Readers are saving

/**
 * Why this title does not qualify for Saving tonight, or null when it does.
 * Checked in order, so the reason names the first floor it missed.
 */
export function savingMiss(s, title) {
  if (!s) return 'no numbers this week'
  if ((s.savers7 || 0) < FLOORS.savers7) return `saved by ${s.savers7 || 0} of ${FLOORS.savers7} people`
  if ((s.saveDays7 || 0) < FLOORS.saveDays7) return `saves on ${s.saveDays7 || 0} of ${FLOORS.saveDays7} days`
  const shared = sharedMiss(s, title)
  if (shared) return shared
  if ((s.unsaves7 || 0) > FLOORS.unsaveShare * (s.saves7 || 0)) return 'removed from lists too often'
  return null
}

/** Distinct savers, lifted when a title is saved more often than it is opened. */
export function savingScore(s) {
  const lift = Math.min((s.saves7 || 0) / Math.max(s.opens7 || 0, 1), 1)
  return round2((s.savers7 || 0) * (1 + lift))
}

/** The line shown on /my-admin next to the slot. Short enough for a phone. */
export function savingReason(s) {
  return cut(`Saved by ${s.savers7 || 0} people this week, opened ${s.opens7 || 0} times`)
}

// ------------------------------------------------------------------ Rising this week

/**
 * This week and yesterday against the title's usual. baseDays is how many
 * days the 30-day window really holds (see baseDaysOf).
 */
export function liftsOf(s, baseDays = 30) {
  const r30 = (s.opens30 || 0) / Math.max(baseDays, 1)
  return {
    lift7: ((s.opens7 || 0) + RISING.shrink7) / (7 * r30 + RISING.shrink7),
    lift1: ((s.opens1 || 0) + RISING.shrink1) / (r30 + RISING.shrink1),
  }
}

export function risingMiss(s, title, ctx = {}) {
  if (!s) return 'no numbers this week'
  const shared = sharedMiss(s, title, { opens: true })
  if (shared) return shared
  // Nothing before this week means there is no "usual" to rise from. Such a
  // title is new, and New and noticed is the place for it.
  if ((s.opens30 || 0) <= (s.opens7 || 0)) return 'no history before this week'
  const { lift7, lift1 } = liftsOf(s, ctx.baseDays)
  const opens7 = s.opens7 || 0
  if (opens7 >= RISING.minOpens7 && lift7 >= RISING.lift7) return null
  if (opens7 >= RISING.spikeOpens7 && lift1 >= RISING.lift1) return null
  if (opens7 < RISING.minOpens7) return `opened ${opens7} of ${RISING.minOpens7} times this week`
  return `opened ${lift7.toFixed(1)}x its usual, needs ${RISING.lift7}x`
}

export function risingScore(s, ctx = {}) {
  const { lift7, lift1 } = liftsOf(s, ctx.baseDays)
  return round2(lift7 * Math.log10((s.opens7 || 0) + 10) + 0.5 * Math.min(lift1, 4))
}

export function risingReason(s, ctx = {}) {
  const { lift7 } = liftsOf(s, ctx.baseDays)
  return cut(`Opened ${lift7.toFixed(1)} times its usual this week (${s.opens7 || 0} opens, ${s.people7 || 0} people)`)
}

// ------------------------------------------------------------------ New and noticed

/**
 * The day a title became new, or null when it is not new. A first day the
 * counter saw is believed only well after the counter began; a start date
 * from AniList is always believed.
 */
export function newSince(s, title, ctx = {}) {
  const last = ctx.lastDay
  if (!last) return null
  const trustFrom = ctx.historyStart ? addDays(ctx.historyStart, NEW.historyMargin) : null
  const first = s?.firstDay
  if (first && trustFrom && first >= trustFrom && daysBetween(first, last) < NEW.firstSeenDays) return first
  const start = startDayOf(title?.startDate)
  if (start && start <= last && daysBetween(start, last) < NEW.startDays) return start
  return null
}

export function newMiss(s, title, ctx = {}) {
  if (!s) return 'no numbers this week'
  if (!newSince(s, title, ctx)) return 'not new: older than 30 days here and 120 on AniList'
  if ((s.opens7 || 0) < NEW.minOpens7) return `opened ${s.opens7 || 0} of ${NEW.minOpens7} times this week`
  return sharedMiss(s, title, { opens: true })
}

/** Opens, lifted when readers go on to read or watch it. */
export function newScore(s) {
  const handoff = Math.min((s.outs7 || 0) / Math.max(s.opens7 || 0, 1), 1)
  return round2((s.opens7 || 0) * (0.5 + handoff))
}

export function newReason(s, ctx = {}, title = null) {
  const since = newSince(s, title, ctx)
  return cut(`New since ${since || 'recently'}, opened ${s.opens7 || 0} times by ${s.people7 || 0} people this week`)
}

// ------------------------------------------------------------------ Most opened this month

export function monthMiss(s, title) {
  if (!s) return 'no numbers this month'
  const shared = sharedMiss(s, title, { win: 30, opens: true })
  if (shared) return shared
  if ((s.opens30 || 0) < MONTH.minOpens30) return `opened ${s.opens30 || 0} of ${MONTH.minOpens30} times this month`
  const handoff = (s.outs30 || 0) / Math.max(s.opens30 || 0, 1)
  if (handoff < MONTH.minHandoff) return `${Math.round(handoff * 1000) / 10}% went on to read or watch, needs 2%`
  return null
}

export function monthScore(s) {
  const handoff = Math.min((s.outs30 || 0) / Math.max(s.opens30 || 0, 1), 1)
  return round2((s.opens30 || 0) * (0.5 + handoff))
}

export function monthReason(s) {
  const pct = Math.round(((s.outs30 || 0) / Math.max(s.opens30 || 0, 1)) * 100)
  return cut(`Opened ${s.opens30 || 0} times this month by ${s.people30 || 0} people, ${pct}% went on to read or watch`)
}

// Each section's rules in one place. strength orders the "kept off" list on
// /my-admin, so the titles closest to making it are shown first.
const RULES = {
  rising: { miss: risingMiss, score: risingScore, reason: risingReason, strength: (s) => s.opens7 || 0 },
  saving: {
    miss: savingMiss,
    score: savingScore,
    reason: savingReason,
    strength: (s) => (s.savers7 || 0) * 1e6 + (s.saves7 || 0),
  },
  new: { miss: newMiss, score: newScore, reason: newReason, strength: (s) => s.opens7 || 0 },
  month: { miss: monthMiss, score: monthScore, reason: monthReason, strength: (s) => s.opens30 || 0 },
}

// ------------------------------------------------------------------ loop check

/**
 * How often one slot was on screen and how often it was opened from there,
 * counted from the night it was first shown to the last closed day.
 *
 * Since the homepage sends its own numbers (home_seen and home_click), a day
 * that has them uses them: times the section was really seen, and clicks on
 * this title in this section. A day before that falls back to the rough
 * phase 1 measure: every homepage view is a chance to see every section, and
 * any open of the title straight after the homepage counts.
 */
export function exposureOf(item, key, loop, lastDay) {
  if (!item.shown_since) return { shown: 0, opened: 0 }
  const seen = loop.seen || {}
  const clicks = loop.clicks?.get(`${key}:${item.id}`) || {}
  const opens = loop.fromHome?.get(item.path) || {}
  let shown = 0
  let opened = 0
  for (let d = item.shown_since; d <= lastDay; d = addDays(d, 1)) {
    if (seen[d]) {
      shown += seen[d][key] || 0
      opened += clicks[d] || 0
    } else {
      shown += loop.homeViews?.[d] || 0
      opened += opens[d] || 0
    }
  }
  return { shown, opened }
}

/** Middle value, or 0 for an empty list. */
export function median(list) {
  if (!list.length) return 0
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Slots that have had their chance and are not opened: after 7 nights and
 * 1,500 exposures, a rate under a quarter of the section's median (or under
 * 0.1 percent) gives the slot back. Returns a Map of id -> reason. Pinned
 * slots are never dropped; the tab flags them instead.
 */
export function loopDrops(items, nightsOf) {
  const ready = items.filter((it) => nightsOf(it) >= DROP.minNights && it.shown >= DROP.minExposure)
  const mid = median(ready.map((it) => it.opened / it.shown))
  const out = new Map()
  for (const it of ready) {
    if (it.pinned) continue
    const rate = it.opened / it.shown
    if (rate < DROP.minRate || rate < DROP.shareOfMedian * mid) {
      out.set(it.id, `shown ${it.shown} times, opened ${it.opened} times`)
    }
  }
  return out
}

// ------------------------------------------------------------------ the plan

const byScore = (a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.id - b.id)

/** An empty plan, the shape data/home-auto.json always has. */
export function emptyPlan(night = '') {
  return { night, source: 'none', sections: {}, cooldown: {}, flips: {}, frozen: {}, next: {}, rejected: {} }
}

/**
 * Plan one night.
 *
 * input = {
 *   night:        'YYYY-MM-DD', the night the plan is for (the page shows it that day)
 *   titles:       Map id -> catalog record (title, synonyms, genres, tags, popularity, startDate, path)
 *   stats:        Map id -> { saves7, unsaves7, savers7, saveDays7, opens1, opens7, opens30,
 *                             people7, people30, outs7, outs30, daysSeen7, entries7, quick7, firstDay }
 *   loop:         { homeViews: { day: n }, fromHome: Map path -> { day: n },
 *                   seen: { day: { section: n } }, clicks: Map 'section:id' -> { day: n } }
 *   onPage:       Set of ids already on the homepage (the Trending shelves)
 *   blocked:      Set of ids in data/block.json
 *   rules:        data/home-rules.json
 *   prev:         last night's plan, or null
 *   historyStart: the first day the counter has numbers for, or null
 * }
 * returns { plan, decisions }
 */
export function planHome(input) {
  const { night, titles, stats, rules = {}, prev } = input
  const lastDay = addDays(night, -1)
  const loop = input.loop || { homeViews: {}, fromHome: new Map() }
  const ctx = {
    rules,
    blocked: input.blocked || new Set(),
    banned: new Set((rules.ban || []).map(Number)),
    onPage: input.onPage || new Set(),
    lastDay,
    historyStart: input.historyStart || null,
    baseDays: baseDaysOf(input.historyStart, night),
  }
  const old = prev && typeof prev === 'object' ? prev : emptyPlan()
  const plan = emptyPlan(night)
  plan.source = 'd1'
  const decisions = []
  const log = (section, action, id, rule, reason) => {
    const t = id != null ? titles.get(id) : null
    decisions.push({
      night,
      section,
      action,
      id: id ?? null,
      path: t?.path || '',
      title: t?.title || '',
      rule,
      reason: cut(reason),
    })
  }

  // Cooldowns still running tonight carry over; spent ones are forgotten.
  for (const [id, until] of Object.entries(old.cooldown || {})) {
    if (until > night) plan.cooldown[id] = until
  }
  const cooling = (id) => Boolean(plan.cooldown[String(id)])

  // A title sits in one section at most, and never next to a Trending cover.
  const taken = new Set()
  let pageChanges = 0
  const work = {}
  const nightsOf = (it) => daysBetween(it.since, night) + 1
  const scoreOf = (rule, s, title) => (s ? rule.score(s, ctx, title) : 0)
  const reasonOf = (rule, s, title) => (s ? rule.reason(s, ctx, title) : '')

  // 1 and 2, for every section before any new title is placed: what is on
  // the page stays or leaves first, so a title never hops from one shelf to
  // another just because a new shelf would also take it.
  for (const key of PRIORITY) {
    const cfg = SECTIONS[key]
    const rule = RULES[key]
    const before = old.sections?.[key] || { enabled: false, items: [] }
    const pins = new Set(((rules.pin || {})[key] || []).map(Number))
    const kept = []

    for (const oldItem of before.items || []) {
      const id = Number(oldItem.id)
      const title = titles.get(id)
      const s = stats.get(id)
      const item = { ...oldItem, id, path: title?.path || oldItem.path, title: title?.title || oldItem.title || '' }
      const nights = nightsOf(item)
      const unsafe = safetyReason(id, title, ctx)
      if (unsafe) {
        log(key, 'block', id, 'safety', unsafe)
        continue
      }
      if (ctx.onPage.has(id) || taken.has(id)) {
        log(key, 'drop', id, 'once.per.page', 'already on the homepage in another shelf')
        continue
      }
      const pinned = pins.has(id)
      if (!pinned && nights > cfg.maxStay) {
        plan.cooldown[String(id)] = addDays(night, cfg.cooldown)
        log(key, 'drop', id, `${key}.maxstay`, `on the page for ${cfg.maxStay} nights; back after ${cfg.cooldown}`)
        continue
      }
      const miss = rule.miss(s, title, ctx)
      if (miss && !pinned && nights > cfg.minStay) {
        log(key, 'drop', id, `${key}.floor`, `no longer qualifies: ${miss}`)
        continue
      }
      if (miss && !pinned) log(key, 'keep', id, `${key}.minstay`, `kept for its first ${cfg.minStay} nights: ${miss}`)
      kept.push({
        ...item,
        nights,
        score: scoreOf(rule, s, title),
        reason: s ? reasonOf(rule, s, title) : item.reason || '',
        pinned,
      })
      taken.add(id)
    }

    // The closed loop: measured slots that are not opened give their space
    // back. Needs the exposure numbers first.
    for (const it of kept) Object.assign(it, exposureOf(it, key, loop, lastDay))
    const drops = loopDrops(kept, nightsOf)
    const staying = []
    for (const it of kept) {
      if (drops.has(it.id)) {
        plan.cooldown[String(it.id)] = addDays(night, DROP.cooldown)
        log(key, 'drop', it.id, 'drop.ctr', drops.get(it.id))
        taken.delete(it.id)
      } else {
        staying.push(it)
      }
    }
    work[key] = { cfg, rule, before, pins, staying }
  }

  // Pins the owner asked for and that are not in yet. They do not count
  // against the nightly cap: the owner chose them, not the numbers.
  for (const key of PRIORITY) {
    const { rule, pins, staying } = work[key]
    for (const id of [...pins].sort((a, b) => a - b)) {
      if (staying.some((it) => it.id === id)) continue
      const title = titles.get(id)
      const unsafe = safetyReason(id, title, ctx)
      if (unsafe || ctx.onPage.has(id) || taken.has(id)) {
        log(key, 'block', id, 'pin', `pin refused: ${unsafe || 'already on the homepage'}`)
        continue
      }
      const s = stats.get(id)
      staying.push({
        id, path: title.path, title: title.title, since: night, nights: 1,
        score: scoreOf(rule, s, title), reason: 'Chosen by the site owner', pinned: true, shown: 0, opened: 0,
      })
      taken.add(id)
      log(key, 'pin', id, 'pin', 'pinned in data/home-rules.json')
    }
  }

  // 3: the best new titles fill the empty slots, a few a night at most, the
  // sections that say the most taking their pick first.
  const safetyLogged = new Set()
  for (const key of PRIORITY) {
    const w = work[key]
    const { cfg, rule, staying } = w
    const candidates = []
    const rejected = []
    for (const [id, s] of stats) {
      if (taken.has(id)) continue
      const strength = rule.strength(s)
      const title = titles.get(id)
      const path = title?.path || ''
      const unsafe = safetyReason(id, title, ctx)
      const trending = ctx.onPage.has(id)
      const why = unsafe
        || (trending ? 'already on the homepage (Trending, airing or coming soon)' : null)
        || rule.miss(s, title, ctx)
        || (cooling(id) ? `cooling down until ${plan.cooldown[String(id)]}` : null)
      if (why) {
        // Nothing to say about a title with no signal for this section.
        if (strength <= 0) continue
        // A title missing from the catalog is not a safety matter, just gone.
        const safety = Boolean(unsafe) && Boolean(title)
        rejected.push({ id, path, title: title?.title || '', strength, trending, reason: cut(why), safety })
        continue
      }
      candidates.push({ id, path, title: title.title, score: scoreOf(rule, s, title), reason: reasonOf(rule, s, title) })
    }
    candidates.sort(byScore)
    const room = Math.max(0, cfg.slots - staying.length)
    const allowed = Math.max(0, Math.min(room, cfg.cap, PAGE_CHANGE_CAP - pageChanges))
    const added = candidates.slice(0, allowed)
    for (const c of added) {
      staying.push({ ...c, since: night, nights: 1, pinned: false, shown: 0, opened: 0 })
      taken.add(c.id)
      pageChanges += 1
      log(key, 'add', c.id, `${key}.floor`, c.reason)
    }
    w.next = candidates.slice(added.length, added.length + 5)
    // Real refusals first; a title that is simply in Trending already says
    // little, so it only fills the list when nothing else was refused.
    rejected.sort((a, b) => Number(a.trending) - Number(b.trending) || b.strength - a.strength || a.id - b.id)
    w.rejected = rejected
    for (const r of rejected.filter((x) => x.safety).slice(0, 5)) {
      if (safetyLogged.has(r.id)) continue
      safetyLogged.add(r.id)
      log(key, 'block', r.id, 'safety', r.reason)
    }
  }

  // 4: too few titles and the section is not drawn. Its titles stay in the
  // file with their ages, so it comes back without churn.
  for (const key of Object.keys(SECTIONS)) {
    const { cfg, before, staying, next, rejected } = work[key]
    let enabled = staying.length >= cfg.floor
    const flips = (old.flips?.[key] || []).filter((d) => daysBetween(d, night) < FLAP_WINDOW)
    const frozen = old.frozen?.[key]
    if (frozen && frozen.until > night) {
      enabled = frozen.enabled && staying.length > 0
      plan.frozen[key] = frozen
    } else if (enabled !== Boolean(before.enabled)) {
      flips.push(night)
      if (flips.length >= 2) {
        // Two changes inside the window: stop here, in the state it was in.
        enabled = Boolean(before.enabled) && staying.length > 0
        plan.frozen[key] = { until: addDays(night, FLAP_WINDOW), enabled }
        log(key, enabled ? 'show' : 'hide', null, 'flap', `showed and hid twice in ${FLAP_WINDOW} nights; frozen for ${FLAP_WINDOW}`)
      } else {
        log(key, enabled ? 'show' : 'hide', null, `${key}.fill`,
          `${staying.length} titles qualified, floor is ${cfg.floor}`)
      }
    }
    plan.flips[key] = flips

    // A hidden section is not on screen, so its slots are not being tested.
    // Their measuring starts again the night the section is shown.
    const items = staying
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byScore(a, b))
      .map((it) => ({
        id: it.id,
        path: it.path,
        title: it.title,
        since: it.since,
        nights: it.nights,
        shown_since: enabled ? it.shown_since || night : null,
        shown: enabled ? it.shown || 0 : 0,
        opened: enabled ? it.opened || 0 : 0,
        score: it.score,
        reason: cut(it.reason || ''),
        pinned: Boolean(it.pinned),
      }))

    plan.sections[key] = { enabled, title: cfg.title, why: cfg.why, items }
    plan.next[key] = next.map(({ id, path, title, score, reason }) => ({ id, path, title, score, reason }))
    plan.rejected[key] = rejected.slice(0, 5).map(({ id, path, title, reason, safety }) => ({ id, path, title, reason, safety }))
  }

  return { plan, decisions }
}

/**
 * Tonight's lines first, then the older ones, keeping `nights` nights of
 * history. The file stays small and the tab can show it without D1.
 */
export function mergeDecisions(old, fresh, night, nights = 90) {
  const oldest = addDays(night, -(nights - 1))
  const kept = (Array.isArray(old) ? old : []).filter((d) => d && d.night >= oldest && d.night !== night)
  return [...fresh, ...kept]
}
