/**
 * The homepage planner's rules. Pure: no fetch, no disk, no clock. The night
 * and every number are passed in, so the same input always gives the same
 * plan, and every rule below is tested in tests/home-plan.test.js.
 *
 * Why it exists: the homepage is the strongest page on the site, and until
 * now every shelf on it was picked by AniList popularity or by hand. Readers
 * already tell us what they care about (they save titles to their list), so a
 * shelf can follow them. The danger is the other side: a handful of people,
 * one person clicking over and over, or a title nobody should see on a front
 * page. So every rule here is a floor or a brake first, and a score second.
 *
 * scripts/plan-home.mjs reads the numbers from D1 and the catalog from disk,
 * calls planHome(), and writes data/home-auto.json and data/home-decisions.json.
 * Phase 1 has one section, "Readers are saving". The others in
 * tasks/auto-homepage-plan.md reuse the same machinery.
 */

// Each section's size and brakes. slots: how many covers at most. floor: fewer
// than this and the section is not drawn at all (a shelf of two looks broken).
// cap: new titles per night, so the page never churns. minStay / maxStay /
// cooldown: nights. A title stays at least minStay nights once added, leaves
// after maxStay, and cannot come back for cooldown nights after that.
export const SECTIONS = {
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
}

// Across the whole page, however many sections there are, at most this many
// titles change in one night. Google's September 2026 spam update is looking
// hard at pages that rewrite themselves; a calm page is the safe page.
export const PAGE_CHANGE_CAP = 8

export const FLOORS = {
  // Distinct people who opened the title's page this week (per-day distinct,
  // summed). Below this the title is simply not known well enough.
  people7: 20,
  // Days out of 7 the title had a row at all. One loud day is not a trend.
  daysSeen7: 3,
  // Distinct people who saved it this week. The heart of the Saving section.
  savers7: 10,
  // Days out of 7 with at least one save.
  saveDays7: 3,
  // When fewer than 70 percent of saves come from distinct people, one person
  // is clicking save over and over. 1 / 0.7 = 1.43.
  oneVisitorRatio: 1.43,
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

// ------------------------------------------------------------------ scoring

/**
 * Why this title does not qualify for Saving tonight, or null when it does.
 * Checked in order, so the reason names the first floor it missed.
 */
export function savingMiss(s, title) {
  if (!s) return 'no numbers this week'
  if ((s.savers7 || 0) < FLOORS.savers7) return `saved by ${s.savers7 || 0} of ${FLOORS.savers7} people`
  if ((s.people7 || 0) < FLOORS.people7) return `opened by ${s.people7 || 0} of ${FLOORS.people7} people`
  if ((s.saveDays7 || 0) < FLOORS.saveDays7) return `saves on ${s.saveDays7 || 0} of ${FLOORS.saveDays7} days`
  if ((s.daysSeen7 || 0) < FLOORS.daysSeen7) return `seen on ${s.daysSeen7 || 0} of ${FLOORS.daysSeen7} days`
  if ((s.saves7 || 0) > FLOORS.oneVisitorRatio * (s.savers7 || 0)) {
    return `one-visitor share: ${s.saves7} saves from ${s.savers7} people`
  }
  if ((title?.popularity || 0) < FLOORS.popularityAnchor && (s.daysSeen7 || 0) < FLOORS.anchorDays) {
    return `unknown on AniList and seen on ${s.daysSeen7 || 0} of ${FLOORS.anchorDays} days`
  }
  const entries = s.entries7 || 0
  if (entries >= FLOORS.quickExitMinEntries && (s.quick7 || 0) / entries > FLOORS.quickExitShare) {
    return 'most visits leave at once'
  }
  if ((s.unsaves7 || 0) > FLOORS.unsaveShare * (s.saves7 || 0)) return 'removed from lists too often'
  return null
}

/** Distinct savers, lifted when a title is saved more often than it is opened. */
export function savingScore(s) {
  const lift = Math.min((s.saves7 || 0) / Math.max(s.opens7 || 0, 1), 1)
  return Math.round((s.savers7 || 0) * (1 + lift) * 100) / 100
}

/** The line shown on /my-admin next to the slot. Short enough for a phone. */
export function savingReason(s) {
  return cut(`Saved by ${s.savers7 || 0} people this week, opened ${s.opens7 || 0} times`)
}

const cut = (text) => (text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text)

// ------------------------------------------------------------------ loop check

/**
 * Homepage views and opens from the homepage for one slot, counted from the
 * night it was first shown to the last closed day. Before the page sends
 * its own section numbers (phase 2), every homepage view counts as a chance
 * to see every section; rough, but the same for every slot.
 */
export function exposureOf(item, loop, lastDay) {
  if (!item.shown_since) return { shown: 0, opened: 0 }
  let shown = 0
  let opened = 0
  const opens = loop.fromHome.get(item.path) || {}
  for (let d = item.shown_since; d <= lastDay; d = addDays(d, 1)) {
    shown += loop.homeViews[d] || 0
    opened += opens[d] || 0
  }
  return { shown, opened }
}

/** Middle value, or 0 for an empty list. */
function median(list) {
  if (!list.length) return 0
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Slots that have had their chance and are not opened. Returns a Map of
 * id -> reason. Pinned slots are never dropped; the tab flags them instead.
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
 *   night:    'YYYY-MM-DD', the night the plan is for (the page shows it that day)
 *   titles:   Map id -> catalog record (title, synonyms, genres, tags, popularity, path)
 *   stats:    Map id -> { saves7, unsaves7, savers7, saveDays7, opens7, people7,
 *                         daysSeen7, entries7, quick7 }
 *   loop:     { homeViews: { day: n }, fromHome: Map path -> { day: n } }
 *   onPage:   Set of ids already on the homepage (the Trending shelves)
 *   blocked:  Set of ids in data/block.json
 *   rules:    data/home-rules.json
 *   prev:     last night's plan, or null
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

  // A title sits in one section at most. With one section in phase 1 this
  // only guards against the Trending shelves; later sections add to it.
  const taken = new Set()
  let pageChanges = 0

  for (const [key, cfg] of Object.entries(SECTIONS)) {
    const before = old.sections?.[key] || { enabled: false, items: [] }
    const pins = new Set(((rules.pin || {})[key] || []).map(Number))
    const nightsOf = (it) => daysBetween(it.since, night) + 1
    const kept = []

    // 1 and 2: every title already in the section either stays or leaves,
    // and the reason is written down.
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
      const miss = savingMiss(s, title)
      if (miss && !pinned && nights > cfg.minStay) {
        log(key, 'drop', id, `${key}.floor`, `no longer qualifies: ${miss}`)
        continue
      }
      if (miss && !pinned) log(key, 'keep', id, `${key}.minstay`, `kept for its first ${cfg.minStay} nights: ${miss}`)
      kept.push({
        ...item,
        nights,
        score: s ? savingScore(s) : 0,
        reason: s ? savingReason(s) : item.reason || '',
        pinned,
      })
    }

    // The closed loop: measured slots that are not opened give their space
    // back. Needs the exposure numbers first.
    for (const it of kept) Object.assign(it, exposureOf(it, loop, lastDay))
    const drops = loopDrops(kept, nightsOf)
    const staying = []
    for (const it of kept) {
      if (drops.has(it.id)) {
        plan.cooldown[String(it.id)] = addDays(night, DROP.cooldown)
        log(key, 'drop', it.id, 'drop.ctr', drops.get(it.id))
      } else {
        staying.push(it)
        taken.add(it.id)
      }
    }

    // Pins the owner asked for and that are not in yet. They do not count
    // against the nightly cap: the owner chose them, not the numbers.
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
        score: s ? savingScore(s) : 0, reason: 'Chosen by the site owner', pinned: true, shown: 0, opened: 0,
      })
      taken.add(id)
      log(key, 'pin', id, 'pin', 'pinned in data/home-rules.json')
    }

    // 3: the best new titles fill the empty slots, a few a night at most.
    const candidates = []
    const rejected = []
    for (const [id, s] of stats) {
      if (taken.has(id) || staying.some((it) => it.id === id)) continue
      const title = titles.get(id)
      const path = title?.path || ''
      const unsafe = safetyReason(id, title, ctx)
      const why = unsafe
        || (ctx.onPage.has(id) ? 'already on the homepage in a Trending shelf' : null)
        || savingMiss(s, title)
        || (cooling(id) ? `cooling down until ${plan.cooldown[String(id)]}` : null)
      if (why) {
        // A title missing from the catalog is not a safety matter, just gone.
        const safety = Boolean(unsafe) && Boolean(title)
        rejected.push({ id, path, title: title?.title || '', savers7: s.savers7 || 0, saves7: s.saves7 || 0, reason: cut(why), safety })
        continue
      }
      candidates.push({ id, path, title: title.title, score: savingScore(s), reason: savingReason(s) })
    }
    candidates.sort(byScore)
    const room = Math.max(0, cfg.slots - staying.length)
    const allowed = Math.min(room, cfg.cap, PAGE_CHANGE_CAP - pageChanges)
    const added = candidates.slice(0, Math.max(0, allowed))
    for (const c of added) {
      staying.push({ ...c, since: night, nights: 1, pinned: false, shown: 0, opened: 0 })
      taken.add(c.id)
      pageChanges += 1
      log(key, 'add', c.id, `${key}.floor`, c.reason)
    }
    const next = candidates.slice(added.length, added.length + 5)

    // 4: too few titles and the section is not drawn. Its titles stay in the
    // file with their ages, so it comes back without churn.
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
    rejected.sort((a, b) => b.savers7 - a.savers7 || b.saves7 - a.saves7 || a.id - b.id)
    plan.rejected[key] = rejected.slice(0, 5).map(({ id, path, title, reason }) => ({ id, path, title, reason }))
    for (const r of rejected.filter((x) => x.safety && x.saves7 > 0).slice(0, 5)) {
      log(key, 'block', r.id, 'safety', r.reason)
    }
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
