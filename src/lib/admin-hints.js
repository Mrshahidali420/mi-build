/**
 * The "What to do" lines on /my-admin.
 *
 * Each rule is a plain function: numbers in, one hint out, or null when there
 * is nothing worth saying. No database, no page, so every rule is tested with
 * fixed numbers (tests/admin-hints.test.js).
 *
 * A hint is { text, level }. level is 'act' (do something), 'watch' (keep an
 * eye on it) or 'good' (it works, leave it alone).
 *
 * Two rules hold for every hint here:
 *   - A small number says nothing. Every rule has a floor, so one visitor
 *     cannot fill the page with advice.
 *   - Never "noindex" a page. A thin page that already ranks is made fuller,
 *     never hidden from Google.
 */

// Below these, a share swings too much to act on.
export const MIN_ENTRIES = 20
export const MIN_VIEWS = 20
export const MIN_WEEK_VISITS = 50

const hint = (text, level = 'act') => ({ text, level })

/** A change as a whole percent, or null when there is nothing to compare to. */
export function change(now, before) {
  const a = Number(now) || 0
  const b = Number(before) || 0
  if (!b) return null
  return Math.round(((a - b) / b) * 100)
}

/** "▲ 12% vs the 7 days before", or '' when there is no earlier number. */
export function changeWords(now, before, span = 'the 7 days before') {
  const pct = change(now, before)
  if (pct === null) return ''
  if (pct === 0) return `same as ${span}`
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${span}`
}

/** Visits this week against last week. */
export function trafficHint(now, before) {
  if ((Number(before) || 0) < MIN_WEEK_VISITS) return null
  const pct = change(now, before)
  if (pct === null) return null
  if (pct <= -20) {
    return hint(
      `Visits fell ${Math.abs(pct)}% on last week. Open Search Console and look for pages that lost clicks or dropped out of the index.`
    )
  }
  if (pct >= 20) return hint(`Visits rose ${pct}% on last week. See which pages grew on the Pages tab and give them more links.`, 'good')
  return null
}

/**
 * A sender in this week's top five that sent nobody last week. `named` turns
 * a source key into words.
 */
export function newSourceHint(topNow, before, named = (s) => s) {
  const seen = new Set(before.filter((row) => (row.entries || 0) > 0).map((row) => row.source))
  const fresh = topNow.find((row) => row.source && !seen.has(row.source) && (row.entries || 0) >= 3)
  if (!fresh) return null
  return hint(`${named(fresh.source)} is new in your top five senders. Open it and see what links to you.`, 'watch')
}

/** A page that brings people in but hands few of them on. */
export function entryPageHint(row) {
  const entries = Number(row.entries) || 0
  if (entries < MIN_ENTRIES) return null
  const views = Number(row.views) || 0
  const rate = views ? ((Number(row.clicks) || 0) / views) * 100 : 0
  if (rate >= 2) return null
  return hint('Brings people in, but under 2 in 100 click out. Check its platform links, and add a BuyBox if it has none.')
}

/** A page where most arrivals leave without doing anything. */
export function quickExitHint(row) {
  const entries = Number(row.entries) || 0
  if (entries < MIN_ENTRIES) return null
  const share = (Number(row.quick_exits) || 0) / entries
  if (share <= 0.7) return null
  return hint(
    `${Math.round(share * 100)}% arrive and leave without a click. The first screen does not answer their question: move the where to read box up and make the page fuller.`
  )
}

/** A title people save a lot but rarely open. */
export function savedHint(saves, views) {
  const s = Number(saves) || 0
  if (s < 3) return null
  if ((Number(views) || 0) > s * 5) return null
  return hint('Saved often for how rarely it is opened. Feature it on the homepage.', 'watch')
}

/** Many readers drop the same title. */
export function droppedHint(dropped, allStatus) {
  const d = Number(dropped) || 0
  const all = Number(allStatus) || 0
  if (d < 3 || !all || d / all < 0.3) return null
  return hint('Many readers mark it Dropped. Check that its platform links still work and point at the right title.')
}

/** AniList import failing. errors = everything that was not ok or empty. */
export function importHint(ok, empty, errors) {
  const total = (Number(ok) || 0) + (Number(empty) || 0) + (Number(errors) || 0)
  if (total < 5) return null
  const share = (Number(errors) || 0) / total
  if (share <= 0.2) return null
  return hint(`${Math.round(share * 100)}% of AniList imports fail. Try one yourself on /my-list with a public AniList name.`)
}

/** The For you feed shown but not clicked. */
export function feedHint(views, clicks) {
  const v = Number(views) || 0
  if (v < 50) return null
  const ctr = ((Number(clicks) || 0) / v) * 100
  if (ctr >= 2) return null
  return hint('People see the For you feed but under 2 in 100 click it. Try fewer picks, or move it lower.', 'watch')
}

/** Words people searched that found nothing. There is always one thing to do. */
export function missingTitleHint(count) {
  if (!(Number(count) > 0)) return null
  return hint(
    'Find each title on anilist.co, add its id to the "media" list in data/keep.json, and run the catalog workflow. The page comes back on the next build.'
  )
}

/** The platform readers pick most. */
export function platformHint(top) {
  if (!top || (Number(top.total) || 0) < 10) return null
  return hint(`${top.name} gets the most clicks. Put it first in the platform list on title pages.`, 'good')
}

/** A broken address people keep hitting. */
export function brokenLinkHint(hits) {
  if ((Number(hits) || 0) < 3) return null
  return hint('Hit 3 times or more. Add it to data/manual-redirects.json, pointed at the page that answers it.')
}

/** A busy page with no clicks at all. */
export function noClickHint(row) {
  if ((Number(row.views) || 0) < MIN_VIEWS || (Number(row.clicks) || 0) > 0) return null
  return hint('Seen a lot, never clicked. It may have no platforms listed: check its data on AniList.', 'watch')
}

/** The night job did not close yesterday. `lastDay` is its newest day. */
// A homepage plan older than this is stale: the self-updating shelves have
// stopped following readers. Ten nights, so one or two bad nights stay quiet.
export const PLAN_STALE_NIGHTS = 10

/**
 * How the homepage planner is doing, for the Homepage and Health tabs.
 * planNight: the night in data/home-auto.json. log: data/home-decisions.json,
 * newest first. Returns { age, line, hint }.
 */
export function planHealth(planNight, log, today) {
  const list = Array.isArray(log) ? log : []
  const age = planNight
    ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${planNight}T00:00:00Z`)) / 86400000)
    : null
  const skip = list.find((d) => d && d.action === 'skip' && (!planNight || d.night > planNight))
  const changes = list.filter((d) => d && d.night === planNight && ['add', 'drop', 'block'].includes(d.action)).length
  const line = skip
    ? `Skipped on ${skip.night}: ${skip.reason}.`
    : planNight
      ? `Planned on ${planNight}, ${changes} ${changes === 1 ? 'change' : 'changes'}.`
      : 'Not planned yet.'
  if (skip && /permission|403|401/.test(skip.reason)) {
    return {
      age,
      line,
      hint: hint('The deploy token cannot read D1. In the Cloudflare dashboard, give the token Account > D1 > Read (or add a CLOUDFLARE_D1_TOKEN secret with it).'),
    }
  }
  if (age != null && age > PLAN_STALE_NIGHTS) {
    return { age, line, hint: hint(`The homepage plan is ${age} nights old, so its shelves no longer follow readers. Check the "Plan the homepage" step in the deploy job.`) }
  }
  return { age, line, hint: null }
}

export function rollupHint(lastDay, yesterday) {
  if (lastDay && lastDay >= yesterday) return null
  return hint(
    `The night job has not closed ${yesterday} yet. It runs at 00:10 UTC; if this is still here after 01:00, check the Worker's cron in the Cloudflare dashboard.`
  )
}

// Every event costs this many written rows in D1: the row, the one index on
// `events`, and the AUTOINCREMENT counter. Measured on 21-23 Sep 2026 before
// the change (about 6 with four indexes); see db/schema.sql.
export const WRITES_PER_EVENT = 3
// The night job writes the rollups, and every rollup row has a primary key
// index too. A generous allowance, plus up to 300 daily_from_home rows (and
// their key) for the homepage shelves since 0004.
export const NIGHT_WRITES = 3600
export const D1_WRITE_LIMIT = 100000

/** How close a day of events comes to the free D1 write limit. */
export function writeLoadHint(eventsPerDay) {
  const writes = (Number(eventsPerDay) || 0) * WRITES_PER_EVENT + NIGHT_WRITES
  const share = writes / D1_WRITE_LIMIT
  if (share < 0.5) return null
  return hint(
    `About ${Math.round(share * 100)}% of the free D1 write allowance is used. Raise MI_LEAVE_SAMPLE to 4 in src/layouts/Base.astro before it reaches 100%.`,
    share >= 0.8 ? 'act' : 'watch'
  )
}

/** The three hints worth doing first, from all tabs. 'act' before 'watch'. */
export function topHints(hints, limit = 3) {
  const order = { act: 0, watch: 1, good: 2 }
  return hints
    .filter(Boolean)
    .map((h, i) => ({ ...h, i }))
    .sort((a, b) => order[a.level] - order[b.level] || a.i - b.i)
    .slice(0, limit)
    .map(({ i, ...h }) => h)
}
