/**
 * Plan the homepage's self-updating sections from last night's numbers.
 *
 *   node scripts/plan-home.mjs              the deploy job (Cloudflare API, token in env)
 *   node scripts/plan-home.mjs --wrangler   on the owner's PC (wrangler login)
 *   node scripts/plan-home.mjs --dry        print what it would do, write nothing
 *   node scripts/plan-home.mjs --night=2026-09-27   plan a given night
 *
 * Reads the rollup tables (and one small raw question: distinct savers over
 * 7 days) from D1, the catalog and the slug registry from data/, and writes
 * data/home-auto.json (what the homepage shows) and data/home-decisions.json
 * (what changed and why, for /my-admin/homepage). The rules live in
 * src/lib/home-plan.mjs. The owner's bans and pins come from
 * data/home-rules.json plus the home_rules table the /my-admin buttons write
 * (src/lib/owner-rules.mjs).
 *
 * It never fails the deploy. When D1 cannot be read, the token is refused,
 * the answer makes no sense, or last night's rollup is missing, it leaves
 * data/home-auto.json exactly as it was, writes one "skip" line to the
 * decisions log, prints a warning, and exits 0. The build then uses the
 * last good plan (or the committed seed).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileAtomic, writeJsonAtomic } from '../src/lib/write-atomic.mjs'
import { queryD1, queryD1Wrangler } from '../src/lib/d1-api.mjs'
import { planHome, mergeDecisions, addDays, SECTIONS } from '../src/lib/home-plan.mjs'
import { RULES_READ, mergeRules } from '../src/lib/owner-rules.mjs'
import { upcomingAnime } from '../src/lib/schedule.mjs'
import { HANDOFF_MIN_OPENS } from '../src/lib/alike.mjs'
import { engineSql, titlePageSql, titlePagePath, buildNameIndex, searchTitleId } from '../src/lib/search-signals.js'

const TITLE_TYPES = "('manhwa','manga','manhua','novel','anime')"
// The Trending shelves on the homepage show the first 18 of each list; a
// title there must not be shown a second time (owner's rule, 27 Sep 2026).
const TRENDING_SIZE = 18

const readJson = (file, fallback) => {
  if (!existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** The questions, all bounded by day, all on closed days only. */
export const QUERIES = {
  rollup: 'SELECT day FROM rollup_log WHERE day = ?',
  // The first day the counter holds pages for. Until 30 days have passed the
  // "usual" of a title is worked out over the days that exist, not over 30.
  history: 'SELECT MIN(day) AS day FROM daily_pages',
  pages: `SELECT day, path, views, people, entries, quick_exits, clicks FROM daily_pages
          WHERE day >= ? AND day <= ? AND page_type IN ${TITLE_TYPES}`,
  // Only pages first counted inside the window: the rest cannot be new.
  firsts: `SELECT path, first_day FROM total_pages
           WHERE first_day >= ? AND page_type IN ${TITLE_TYPES}`,
  actions: `SELECT day, name, item, SUM(n) AS n FROM daily_actions
            WHERE day >= ? AND day <= ? AND name IN ('list_add', 'list_remove')
            GROUP BY day, name, item`,
  // The one raw question: true distinct people over the whole week. The
  // rollup's people column is per day, so one person saving on 3 days would
  // count 3 times there. Walks the (day, kind) index over 7 days of act rows.
  savers: `SELECT item, COUNT(DISTINCT visitor) AS people FROM events
           WHERE day >= ? AND day <= ? AND kind = 'act' AND name = 'list_add' AND visitor <> ''
           GROUP BY item`,
  home: "SELECT day, views FROM daily_pages WHERE path = '/' AND day >= ? AND day <= ?",
  fromHome: 'SELECT day, path, views FROM daily_from_home WHERE day >= ? AND day <= ?',
  // What the homepage itself reports: which shelves were seen (one row per
  // homepage view, the shelves in detail) and which title was opened from
  // which shelf.
  homeActs: `SELECT day, name, item, detail, n FROM daily_actions
             WHERE day >= ? AND day <= ? AND name IN ('home_seen', 'home_click')`,
  // The bans and pins set with the buttons on /my-admin/homepage. In the main
  // set on purpose: a night that cannot read them skips and keeps the last
  // plan, because planning without them could put a hidden title back.
  ownerRules: RULES_READ,
}

/**
 * The questions behind "People are searching for" (src/lib/home-searching.mjs).
 * Kept apart from QUERIES: the tables are newer (0005-search-and-bots.sql), and
 * a problem here must cost this one shelf, never the whole night's plan.
 */
export const SEARCH_QUERIES = {
  history: 'SELECT MIN(day) AS day FROM daily_search_arrivals',
  // 30 days of arrivals per page and engine, from the night job's table.
  arrivals: 'SELECT day, path, engine, views FROM daily_search_arrivals WHERE day >= ? AND day <= ?',
  // True distinct people over the week, which the per-day table cannot say.
  // An answer page is folded into its title in SQL, so one person landing on
  // a title and on its /characters page is one person. Walks the (day, kind)
  // index over 7 days of views.
  arrivalPeople: `SELECT ${titlePageSql('path')} AS page,
           COUNT(DISTINCT visitor) AS people, COUNT(DISTINCT day) AS days
         FROM events
         WHERE day >= ? AND day <= ? AND kind = 'view' AND referrer <> '' AND visitor <> ''
           AND ${engineSql('referrer')} <> ''
         GROUP BY page`,
  // Our own search box over the week, one row per person, day and search.
  // The words and the visitor ids stay in this run's memory; only counts per
  // title are written (data/home-auto.json).
  searches: `SELECT name, item, visitor, day FROM events
             WHERE day >= ? AND day <= ? AND kind = 'search' AND visitor <> ''
               AND name IN ('search_pick', 'search_none')
             GROUP BY name, item, visitor, day`,
}

/** id -> current path, and every path (old ones too) -> id, from the registry. */
function pathsFrom(registry) {
  const pathOf = new Map()
  const idOf = new Map()
  for (const [key, entry] of Object.entries(registry?.entries || {})) {
    if (!key.startsWith('t:') || !entry?.ns || !entry?.slug) continue
    const id = Number(key.slice(2))
    const path = `/${entry.ns}/${entry.slug}`
    pathOf.set(id, path)
    idOf.set(path, id)
    for (const old of entry.past || []) if (!idOf.has(old)) idOf.set(old, id)
  }
  return { pathOf, idOf }
}

/**
 * Ids already on the homepage, worked out the way index.astro does: the
 * Trending shelves, Anime airing this week, Most anticipated and Coming soon.
 * The page drops these from an auto shelf anyway; leaving them out here too
 * means the planner never spends a slot on a cover the page will not draw.
 */
function onPageIds(comicsAll, animeAll, blocked, nowSec = Date.now() / 1000) {
  const keep = (list) => list.filter((x) => !blocked.has(x.id)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
  const comics = keep(comicsAll.filter((c) => c.kind !== 'novel'))
  const novels = keep(comicsAll.filter((c) => c.kind === 'novel'))
  const anime = keep(animeAll)
  const shelves = [
    comics.filter((c) => c.country === 'KR'),
    comics.filter((c) => c.country === 'JP'),
    comics.filter((c) => c.country === 'CN'),
    anime,
    novels,
  ]
  const ids = new Set(shelves.flatMap((list) => list.slice(0, TRENDING_SIZE).map((x) => x.id)))
  const airing = anime
    .filter((a) => a.nextEpisode && a.nextEpisode.at > nowSec && a.nextEpisode.at < nowSec + 7 * 86400)
    .sort((a, b) => a.nextEpisode.at - b.nextEpisode.at)
    .slice(0, 8)
  const coming = upcomingAnime(anime, nowSec)
  for (const a of [...airing, ...coming.anticipated.slice(0, 6), ...coming.dated.slice(0, 6)]) ids.add(a.id)
  return ids
}

const blankStats = () => ({
  saves7: 0, unsaves7: 0, savers7: 0, saveDays7: 0, opens1: 0, opens7: 0, opens30: 0,
  people7: 0, people30: 0, outs7: 0, outs30: 0, daysSeen7: 0, entries7: 0, quick7: 0, firstDay: null,
  g1: 0, g7: 0, g30: 0, gPeople7: 0, gDays7: 0, gGoogle7: 0, s7: 0, sPeople7: 0, sDays7: 0,
})

/**
 * Per-title numbers for the last day, week and month, from the rows D1 sent
 * back. `last` is the last closed day, `from7` the first day of the week.
 */
export function statsFrom(rows, idOf, { last, from7 } = {}) {
  const stats = new Map()
  const of = (id) => {
    if (!stats.has(id)) stats.set(id, blankStats())
    return stats.get(id)
  }
  const saveDays = new Map()
  for (const r of rows.actions) {
    const id = Number(r.item)
    if (!Number.isInteger(id) || id <= 0) continue
    const s = of(id)
    if (r.name === 'list_add') {
      s.saves7 += Number(r.n) || 0
      if (!saveDays.has(id)) saveDays.set(id, new Set())
      saveDays.get(id).add(r.day)
    } else {
      s.unsaves7 += Number(r.n) || 0
    }
  }
  for (const [id, days] of saveDays) of(id).saveDays7 = days.size
  for (const r of rows.savers) {
    const id = Number(r.item)
    if (stats.has(id)) stats.get(id).savers7 = Number(r.people) || 0
  }
  // Page rows are 30 days; the week and yesterday are cut from them.
  const seen = new Map()
  for (const r of rows.pages) {
    const id = idOf.get(r.path)
    if (id === undefined) continue
    const s = of(id)
    const views = Number(r.views) || 0
    s.opens30 += views
    s.people30 += Number(r.people) || 0
    s.outs30 += Number(r.clicks) || 0
    if (from7 && r.day < from7) continue
    s.opens7 += views
    s.people7 += Number(r.people) || 0
    s.outs7 += Number(r.clicks) || 0
    s.entries7 += Number(r.entries) || 0
    s.quick7 += Number(r.quick_exits) || 0
    if (r.day === last) s.opens1 += views
    if (!seen.has(id)) seen.set(id, new Set())
    seen.get(id).add(r.day)
  }
  for (const [id, days] of seen) stats.get(id).daysSeen7 = days.size
  // A title that moved address has two first days; the older one is true.
  for (const r of rows.firsts || []) {
    const id = idOf.get(r.path)
    if (id === undefined || !stats.has(id) || !r.first_day) continue
    const s = stats.get(id)
    if (!s.firstDay || r.first_day < s.firstDay) s.firstDay = r.first_day
  }
  return stats
}

/**
 * Add the search numbers to the per-title stats: search-engine arrivals
 * (30 days from the rollup, distinct people and days over the week from the
 * raw rows) and our own search box (picked results, and searches that found
 * nothing but were exactly a title's name). `names` is buildNameIndex().
 */
export function searchStatsInto(stats, rows, idOf, names, { last, from7 } = {}) {
  const of = (id) => {
    if (!stats.has(id)) stats.set(id, blankStats())
    return stats.get(id)
  }
  const idFor = (path) => idOf.get(titlePagePath(path))
  for (const r of rows.arrivals || []) {
    const id = idFor(r.path)
    if (id === undefined) continue
    const s = of(id)
    const views = Number(r.views) || 0
    s.g30 += views
    if (from7 && r.day < from7) continue
    s.g7 += views
    if (r.engine === 'google') s.gGoogle7 += views
    if (r.day === last) s.g1 += views
  }
  for (const r of rows.arrivalPeople || []) {
    const id = idFor(r.page)
    if (id === undefined) continue
    const s = of(id)
    // A title that moved has two addresses; the same person on both is rare
    // enough that adding them up is the honest guess.
    s.gPeople7 += Number(r.people) || 0
    s.gDays7 = Math.max(s.gDays7, Number(r.days) || 0)
  }
  const people = new Map()
  const days = new Map()
  for (const r of rows.searches || []) {
    const id = searchTitleId(r, { idOf, names })
    if (id == null) continue
    of(id).s7 += 1
    if (!people.has(id)) people.set(id, new Set())
    if (!days.has(id)) days.set(id, new Set())
    people.get(id).add(r.visitor)
    days.get(id).add(r.day)
  }
  for (const [id, set] of people) stats.get(id).sPeople7 = set.size
  for (const [id, set] of days) stats.get(id).sDays7 = set.size
  return stats
}

/** The homepage's own shelves, when detail lists them ("rising-saving"). */
const shelvesIn = (detail) => String(detail || '').split('-').filter(Boolean)

export function loopFrom(rows) {
  const homeViews = {}
  for (const r of rows.home) homeViews[r.day] = (homeViews[r.day] || 0) + (Number(r.views) || 0)
  const fromHome = new Map()
  for (const r of rows.fromHome) {
    if (!fromHome.has(r.path)) fromHome.set(r.path, {})
    fromHome.get(r.path)[r.day] = Number(r.views) || 0
  }
  const seen = {}
  const clicks = new Map()
  for (const r of rows.homeActs || []) {
    const n = Number(r.n) || 0
    if (r.name === 'home_seen') {
      const day = (seen[r.day] ||= {})
      for (const key of shelvesIn(r.detail)) day[key] = (day[key] || 0) + n
    } else if (r.name === 'home_click') {
      const key = `${r.detail}:${Number(r.item)}`
      if (!clicks.has(key)) clicks.set(key, {})
      const byDay = clicks.get(key)
      byDay[r.day] = (byDay[r.day] || 0) + n
    }
  }
  return { homeViews, fromHome, seen, clicks }
}

/**
 * Opens and clicks out over 30 days per title id, for the "read something
 * like it" picks on unlicensed pages (src/lib/alike.mjs). Pages under the
 * floor are left out: a rate from a handful of opens is noise. Counts only,
 * no visitor data, so the file is safe to keep in the Actions cache.
 */
export function handoffFrom(stats, night) {
  const pages = {}
  for (const [id, s] of [...stats].sort((a, b) => a[0] - b[0])) {
    if (s.opens30 >= HANDOFF_MIN_OPENS) pages[id] = [s.opens30, s.outs30]
  }
  return { night, min: HANDOFF_MIN_OPENS, pages }
}

const isArrayOfRows = (x) => Array.isArray(x) && x.every((r) => r && typeof r === 'object')

/** The decisions file, one line per decision so a diff reads line by line. */
function decisionsText(list) {
  return list.length ? `[\n${list.map((d) => JSON.stringify(d)).join(',\n')}\n]\n` : '[]\n'
}

/**
 * One run. `query(sql, params)` returns rows or throws. Returns
 * { ok, reason?, plan?, decisions? }. Never throws for a D1 problem.
 */
export async function runPlan({ query, dataDir = join(process.cwd(), 'data'), night, dry = false, say = console.log }) {
  const autoFile = join(dataDir, 'home-auto.json')
  const logFile = join(dataDir, 'home-decisions.json')
  let oldLog = []
  try {
    oldLog = readJson(logFile, [])
  } catch {
    oldLog = [] // A torn log is not worth a skipped plan; it starts again.
  }

  const skip = (reason) => {
    say(`::warning::homepage plan skipped: ${reason}`)
    if (!dry) {
      const line = { night, section: 'all', action: 'skip', id: null, path: '', title: '', rule: 'skip', reason: String(reason).slice(0, 119) }
      writeFileAtomic(logFile, decisionsText(mergeDecisions(oldLog, [line], night)))
    }
    return { ok: false, reason }
  }

  let comics, anime, registry, blockRaw, rules, prev
  try {
    comics = readJson(join(dataDir, 'comics.json'), null)
    anime = readJson(join(dataDir, 'anime.json'), null)
    registry = readJson(join(dataDir, 'slug-registry.json'), null)
    blockRaw = readJson(join(dataDir, 'block.json'), { media: [] })
    rules = readJson(join(dataDir, 'home-rules.json'), {})
  } catch (error) {
    return skip(`a data file could not be read: ${error.message.slice(0, 80)}`)
  }
  if (!Array.isArray(comics) || !Array.isArray(anime)) return skip('the catalog is missing')
  if (!registry) return skip('data/slug-registry.json is missing')
  try {
    prev = readJson(autoFile, null)
  } catch {
    prev = null // A bad plan file is replaced by a fresh plan; nothing to keep.
  }

  const last = addDays(night, -1)
  const from7 = addDays(night, -7)
  const from30 = addDays(night, -30)
  const rows = {}
  try {
    const done = await query(QUERIES.rollup, [last])
    if (!isArrayOfRows(done)) return skip('D1 answer was malformed')
    if (!done.length) return skip(`the night job has not closed ${last} yet`)
    rows.history = await query(QUERIES.history, [])
    rows.pages = await query(QUERIES.pages, [from30, last])
    rows.firsts = await query(QUERIES.firsts, [from30])
    rows.actions = await query(QUERIES.actions, [from7, last])
    rows.savers = await query(QUERIES.savers, [from7, last])
    rows.home = await query(QUERIES.home, [from30, last])
    rows.fromHome = await query(QUERIES.fromHome, [from30, last])
    rows.homeActs = await query(QUERIES.homeActs, [from30, last])
    rows.ownerRules = await query(QUERIES.ownerRules, [])
  } catch (error) {
    return skip(error.message || String(error))
  }
  if (!Object.values(rows).every(isArrayOfRows)) return skip('D1 answer was malformed')
  // data/home-rules.json and the buttons, as one set of rules.
  rules = mergeRules(rules, rows.ownerRules)

  // The search questions. Any trouble empties this one shelf and says so;
  // the other shelves are planned as usual.
  const searchRows = { history: [], arrivals: [], arrivalPeople: [], searches: [] }
  try {
    const got = {
      history: await query(SEARCH_QUERIES.history, []),
      arrivals: await query(SEARCH_QUERIES.arrivals, [from30, last]),
      arrivalPeople: await query(SEARCH_QUERIES.arrivalPeople, [from7, last]),
      searches: await query(SEARCH_QUERIES.searches, [from7, last]),
    }
    for (const [key, list] of Object.entries(got)) if (isArrayOfRows(list)) searchRows[key] = list
  } catch (error) {
    say(`::warning::search numbers unavailable, the Hot this week shelf stays empty: ${String(error.message || error).slice(0, 100)}`)
  }

  const blocked = new Set((blockRaw.media || []).map(Number).filter(Number.isInteger))
  const { pathOf, idOf } = pathsFrom(registry)
  const stats = statsFrom(rows, idOf, { last, from7 })
  const historyStart = rows.history[0]?.day || null
  // Exact-name matching is only needed when a search found nothing.
  const names = searchRows.searches.some((r) => r.name === 'search_none')
    ? buildNameIndex([...comics, ...anime].filter((rec) => pathOf.has(rec.id)))
    : new Map()
  searchStatsInto(stats, searchRows, idOf, names, { last, from7 })
  const searchHistoryStart = searchRows.history[0]?.day || null

  // The catalog record for each title the plan may name, with its live path.
  // Every title with numbers is looked at now, not only saved ones.
  const wanted = new Set(stats.keys())
  for (const section of Object.values(prev?.sections || {})) for (const it of section.items || []) wanted.add(Number(it.id))
  for (const ids of Object.values(rules.pin || {})) for (const id of ids) wanted.add(Number(id))
  const titles = new Map()
  for (const rec of [...comics, ...anime]) {
    if (!wanted.has(rec.id) || !pathOf.has(rec.id)) continue
    titles.set(rec.id, { ...rec, path: pathOf.get(rec.id) })
  }

  const { plan, decisions } = planHome({
    night,
    titles,
    stats,
    loop: loopFrom(rows),
    onPage: onPageIds(comics, anime, blocked),
    blocked,
    rules,
    prev,
    historyStart,
    searchHistoryStart,
  })

  say(`homepage plan for ${night}: ${stats.size} titles looked at, counter since ${historyStart || 'unknown'}`)
  for (const key of Object.keys(SECTIONS)) {
    const s = plan.sections[key]
    say(`  ${key}: ${s.enabled ? 'shown' : 'hidden'}, ${s.items.length} titles`)
    for (const it of s.items.slice(0, 5)) say(`    + ${it.title}: ${it.reason}`)
    for (const n of plan.next[key].slice(0, 3)) say(`    > next: ${n.title}: ${n.reason}`)
    for (const r of plan.rejected[key].slice(0, 5)) say(`    - ${r.title || r.id}: ${r.reason}`)
  }
  say(`  ${decisions.length} decisions tonight`)

  const handoff = handoffFrom(stats, night)
  say(`  hand-off rates for ${Object.keys(handoff.pages).length} title pages`)

  if (!dry) {
    writeJsonAtomic(join(dataDir, 'handoff.json'), handoff)
    writeJsonAtomic(autoFile, plan, 2)
    writeFileAtomic(logFile, decisionsText(mergeDecisions(oldLog, decisions, night)))
  }
  return { ok: true, plan, decisions }
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const viaWrangler = args.includes('--wrangler')
  const nightArg = args.find((a) => a.startsWith('--night='))
  const night = nightArg ? nightArg.slice(8) : new Date().toISOString().slice(0, 10)
  const query = viaWrangler ? queryD1Wrangler : queryD1
  try {
    await runPlan({ query, night, dry })
  } catch (error) {
    // Anything unexpected still must not stop the deploy.
    console.log(`::warning::homepage plan crashed: ${error.message}`)
  }
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
