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
 * src/lib/home-plan.mjs.
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
  pages: `SELECT day, path, views, people, entries, quick_exits FROM daily_pages
          WHERE day >= ? AND day <= ? AND page_type IN ${TITLE_TYPES}`,
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

/** Ids in the homepage's Trending shelves, worked out the way index.astro does. */
function trendingIds(comicsAll, anime, blocked) {
  const keep = (list) => list.filter((x) => !blocked.has(x.id)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
  const comics = keep(comicsAll.filter((c) => c.kind !== 'novel'))
  const novels = keep(comicsAll.filter((c) => c.kind === 'novel'))
  const shelves = [
    comics.filter((c) => c.country === 'KR'),
    comics.filter((c) => c.country === 'JP'),
    comics.filter((c) => c.country === 'CN'),
    keep(anime),
    novels,
  ]
  return new Set(shelves.flatMap((list) => list.slice(0, TRENDING_SIZE).map((x) => x.id)))
}

/** Per-title numbers for the week, from the rows D1 sent back. */
export function statsFrom(rows, idOf) {
  const stats = new Map()
  const of = (id) => {
    if (!stats.has(id)) {
      stats.set(id, { saves7: 0, unsaves7: 0, savers7: 0, saveDays7: 0, opens7: 0, people7: 0, daysSeen7: 0, entries7: 0, quick7: 0 })
    }
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
  // Only titles someone saved can be in Saving, so page rows for other
  // titles are skipped rather than kept in memory.
  const seen = new Map()
  for (const r of rows.pages) {
    const id = idOf.get(r.path)
    if (id === undefined || !stats.has(id)) continue
    const s = stats.get(id)
    s.opens7 += Number(r.views) || 0
    s.people7 += Number(r.people) || 0
    s.entries7 += Number(r.entries) || 0
    s.quick7 += Number(r.quick_exits) || 0
    if (!seen.has(id)) seen.set(id, new Set())
    seen.get(id).add(r.day)
  }
  for (const [id, days] of seen) stats.get(id).daysSeen7 = days.size
  return stats
}

function loopFrom(rows) {
  const homeViews = {}
  for (const r of rows.home) homeViews[r.day] = (homeViews[r.day] || 0) + (Number(r.views) || 0)
  const fromHome = new Map()
  for (const r of rows.fromHome) {
    if (!fromHome.has(r.path)) fromHome.set(r.path, {})
    fromHome.get(r.path)[r.day] = Number(r.views) || 0
  }
  return { homeViews, fromHome }
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
    rows.pages = await query(QUERIES.pages, [from7, last])
    rows.actions = await query(QUERIES.actions, [from7, last])
    rows.savers = await query(QUERIES.savers, [from7, last])
    rows.home = await query(QUERIES.home, [from30, last])
    rows.fromHome = await query(QUERIES.fromHome, [from30, last])
  } catch (error) {
    return skip(error.message || String(error))
  }
  if (!Object.values(rows).every(isArrayOfRows)) return skip('D1 answer was malformed')

  const blocked = new Set((blockRaw.media || []).map(Number).filter(Number.isInteger))
  const { pathOf, idOf } = pathsFrom(registry)
  const stats = statsFrom(rows, idOf)

  // The catalog record for each title the plan may name, with its live path.
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
    onPage: trendingIds(comics, anime, blocked),
    blocked,
    rules,
    prev,
  })

  say(`homepage plan for ${night}: ${stats.size} saved titles looked at`)
  for (const key of Object.keys(SECTIONS)) {
    const s = plan.sections[key]
    say(`  ${key}: ${s.enabled ? 'shown' : 'hidden'}, ${s.items.length} titles`)
    for (const it of s.items.slice(0, 5)) say(`    + ${it.title}: ${it.reason}`)
    for (const r of plan.rejected[key].slice(0, 5)) say(`    - ${r.title || r.id}: ${r.reason}`)
  }
  say(`  ${decisions.length} decisions tonight`)

  if (!dry) {
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
