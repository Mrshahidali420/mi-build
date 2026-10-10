#!/usr/bin/env node
/**
 * The internal link graph, rebuilt from the shards the way the pages build
 * their links, so the weakly linked pages can be counted on the real catalog
 * (GitHub Actions only: the local data is a tiny seed).
 *
 *   node scripts/measure-links.mjs --label links
 *
 * Counted for every page Google may index: titles, the sub-pages that are not
 * noindexed (src/lib/thin-pages.mjs), the character pages that are not, and
 * the character /buy pages that are not. Reported: how many have 0, 1 or 2
 * inbound internal links, the best linked pages, and the click depth from the
 * home page (breadth-first over the same graph).
 *
 * An approximation, on purpose. The hubs are modelled from their own rules
 * (60 a page, popularity order, the three-ring pager in Pager.astro, the
 * character wall at 120 a page by favourites, genre lists capped at 10 pages)
 * but the header and footer, guides, moods, platform pages and season hubs are
 * left out, and the home page is taken as the top 18 of each section. So the
 * numbers are a floor for inbound links and a ceiling for depth.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionOf } from '../src/lib/section.mjs'
import { hasFreePage, hasLikePage, hasCastPage, hasBuyPage, hasCharacterBuyPage } from '../src/lib/gates.mjs'
import { indexedFirst } from '../src/lib/thin-pages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SECTIONS = ['manhwa', 'manga', 'manhua', 'anime', 'novel']
export const LIST_PER_PAGE = 60
export const GENRE_PER_PAGE = 60
export const GENRE_MAX_PAGES = 10
export const GENRE_SHOWN = 18
export const WALL_PER_PAGE = 120
export const HOME_PER_SECTION = 18
export const CAST_SHOWN = 12
const SUBS = ['free', 'like', 'characters', 'buy']

/** The page numbers Pager.astro prints on page `current` of `count`. */
export function pagerNumbers(current, count) {
  const farStep = count > 250 ? 100 : count > 60 ? 25 : 10
  const seen = new Set([1, count, current])
  for (let step = 1; step <= 4; step++) seen.add(current - step).add(current + step)
  const nearestTen = Math.round(current / 10) * 10
  for (let step = -5; step <= 5; step++) seen.add(nearestTen + step * 10)
  for (let page = farStep; page < count; page += farStep) seen.add(page)
  return [...seen].filter((page) => page >= 1 && page <= count)
}

const genreSlug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
const pathOf = (row) => (row?.slug ? `/${sectionOf(row)}/${row.slug}` : null)
const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0) || a.slug.localeCompare(b.slug)

/** Only what the graph needs from one title record. */
export function slimTitle(item) {
  const path = pathOf(item)
  const off = new Set(Array.isArray(item.noindex) ? item.noindex : [])
  const gates = { free: hasFreePage(item), like: hasLikePage(item), characters: hasCastPage(item), buy: hasBuyPage(item) }
  const similar = (item.similar || []).map(pathOf).filter(Boolean)
  const shown = new Set((item.similar || []).map((p) => p.slug))
  const recs = (item.recs || []).filter((p) => p.slug !== item.slug && !shown.has(p.slug)).map(pathOf).filter(Boolean)
  const family = (item.relations || []).map((r) => (r.hit ? pathOf(r.hit.item) : null)).filter(Boolean)
  const chain = (item.chain || []).filter((p) => !p.self && p.slug && p.kind).map((p) => `/${p.kind}/${p.slug}`)
  const faces = (item.characters || []).filter((c) => c.image)
  return {
    path,
    section: sectionOf(item),
    slug: item.slug,
    popularity: item.popularity || 0,
    genres: (item.genres || []).map(genreSlug),
    subs: SUBS.filter((s) => gates[s]).map((s) => ({ page: s, indexed: !off.has(s) })),
    out: [...similar, ...recs, ...family, ...chain],
    similar,
    castShown: indexedFirst(faces).slice(0, CAST_SHOWN).map((c) => c.slug),
    castAll: faces.map((c) => c.slug),
  }
}

/** Only what the graph needs from one character record. */
export function slimPerson(person) {
  const rows = person.appearsIn || []
  const mains = rows.filter((a) => a.role === 'MAIN')
  const lead = [...(mains.length ? mains : rows)].sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0]
  return {
    slug: person.slug,
    favourites: person.favourites || 0,
    indexed: !person.noindex,
    buy: hasCharacterBuyPage(person) ? { indexed: !person.noindexBuy } : null,
    titles: rows.map(pathOf).filter(Boolean),
    lead: pathOf(lead),
    people: [...(person.costars || []), ...(person.vaOther || []), ...(person.namesakes || [])].map((p) => p.slug).filter(Boolean),
  }
}

/** The graph: page -> pages it links to, and which pages may be indexed (by group). */
export function buildGraph(titles, people) {
  const out = new Map()
  const groups = new Map() // path -> group, indexable pages only
  const link = (from, to) => {
    if (!to || to === from) return
    if (!out.has(from)) out.set(from, new Set())
    out.get(from).add(to)
  }
  const exists = new Set()
  const titleAt = new Map(titles.map((t) => [t.path, t]))
  const personAt = new Map(people.map((p) => [p.slug, p]))
  const sub = (t, page) => t?.subs.find((s) => s.page === page)
  const linkable = (t, page) => Boolean(sub(t, page)?.indexed)
  const charPath = (slug) => (personAt.has(slug) ? `/character/${slug}` : null)

  for (const t of titles) {
    exists.add(t.path)
    groups.set(t.path, 'title')
    for (const s of t.subs) {
      const path = `${t.path}/${s.page}`
      exists.add(path)
      if (s.indexed) groups.set(path, s.page)
      link(path, t.path)
    }
    t.out.forEach((to) => link(t.path, to))
    t.castShown.forEach((slug) => link(t.path, charPath(slug)))
    t.genres.forEach((g) => link(t.path, `/genre/${g}`))
    for (const s of t.subs) if (s.indexed) link(t.path, `${t.path}/${s.page}`)
    if (linkable(t, 'like')) link(`${t.path}/free`, `${t.path}/like`)
    if (linkable(t, 'buy') && sub(t, 'free')) link(`${t.path}/free`, `${t.path}/buy`)
    if (linkable(t, 'free') && sub(t, 'buy')) link(`${t.path}/buy`, `${t.path}/free`)
    if (sub(t, 'like')) t.similar.forEach((to) => link(`${t.path}/like`, to))
    if (sub(t, 'characters')) t.castAll.forEach((slug) => link(`${t.path}/characters`, charPath(slug)))
  }
  for (const p of people) {
    const path = `/character/${p.slug}`
    exists.add(path)
    if (p.indexed) groups.set(path, 'character')
    p.titles.forEach((to) => link(path, to))
    p.people.forEach((slug) => link(path, charPath(slug)))
    const lead = titleAt.get(p.lead)
    if (linkable(lead, 'characters')) link(path, `${p.lead}/characters`)
    if (p.buy) {
      exists.add(`${path}/buy`)
      if (p.buy.indexed) {
        groups.set(`${path}/buy`, 'characterBuy')
        link(path, `${path}/buy`)
      }
      link(`${path}/buy`, path)
      if (linkable(lead, 'buy')) link(`${path}/buy`, `${p.lead}/buy`)
    }
  }
  addHubs({ titles, people, link, exists })
  // A link to or from a page that does not exist (a face with no page, a
  // sub-page whose gate failed) is dropped.
  for (const [from, set] of out) {
    if (!exists.has(from)) out.delete(from)
    else for (const to of set) if (!exists.has(to)) set.delete(to)
  }
  return { out, groups, exists }
}

/** A paginated list: page 1 at `base`, page n at `${base}/${segment}n`. */
function paged({ base, segment, items, perPage, maxPages = Infinity, link, exists, linksOf }) {
  const count = Math.min(maxPages, Math.ceil(items.length / perPage))
  const href = (n) => (n === 1 ? base : `${base}/${segment}${n}`)
  for (let n = 1; n <= count; n++) {
    exists.add(href(n))
    pagerNumbers(n, count).forEach((m) => link(href(n), href(m)))
    items.slice((n - 1) * perPage, n * perPage).forEach((item) => linksOf(item).forEach((to) => link(href(n), to)))
  }
}

function addHubs({ titles, people, link, exists }) {
  const home = '/'
  exists.add(home).add('/genre').add('/character')
  link(home, '/genre')
  link(home, '/character')
  for (const section of SECTIONS) {
    const items = titles.filter((t) => t.section === section).sort(byPopularity)
    if (!items.length) continue
    link(home, `/${section}`)
    items.slice(0, HOME_PER_SECTION).forEach((t) => link(home, t.path))
    paged({ base: `/${section}`, segment: 'page/', items, perPage: LIST_PER_PAGE, link, exists, linksOf: (t) => [t.path] })
  }
  const byGenre = new Map()
  for (const t of titles) for (const g of t.genres) (byGenre.get(g) || byGenre.set(g, []).get(g)).push(t)
  for (const [g, list] of byGenre) {
    const hub = `/genre/${g}`
    exists.add(hub)
    link('/genre', hub)
    for (const section of SECTIONS) {
      const items = list.filter((t) => t.section === section).sort(byPopularity)
      if (!items.length) continue
      items.slice(0, GENRE_SHOWN).forEach((t) => link(hub, t.path))
      link(hub, `${hub}/${section}`)
      paged({ base: `${hub}/${section}`, segment: '', items, perPage: GENRE_PER_PAGE, maxPages: GENRE_MAX_PAGES, link, exists, linksOf: (t) => [t.path] })
    }
  }
  const wall = [...people].sort((a, b) => b.favourites - a.favourites || a.slug.localeCompare(b.slug))
  paged({
    base: '/character',
    segment: 'page/',
    items: wall,
    perPage: WALL_PER_PAGE,
    link,
    exists,
    linksOf: (p) => [`/character/${p.slug}`, ...(p.buy?.indexed ? [`/character/${p.slug}/buy`] : [])],
  })
}

/** Click depth from the home page, breadth-first. */
export function depthsFrom(out, start = '/') {
  const depth = new Map([[start, 0]])
  let frontier = [start]
  while (frontier.length) {
    const next = []
    for (const from of frontier) {
      for (const to of out.get(from) || []) {
        if (depth.has(to)) continue
        depth.set(to, depth.get(from) + 1)
        next.push(to)
      }
    }
    frontier = next
  }
  return depth
}

const median = (values) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** The numbers, per group of indexable pages. */
export function linkReport({ out, groups }) {
  const inbound = new Map()
  const fromIndexable = new Map()
  for (const [from, set] of out) {
    for (const to of set) {
      inbound.set(to, (inbound.get(to) || 0) + 1)
      if (groups.has(from)) fromIndexable.set(to, (fromIndexable.get(to) || 0) + 1)
    }
  }
  const depth = depthsFrom(out)
  const byGroup = {}
  for (const [path, group] of groups) {
    const g = (byGroup[group] ||= { pages: 0, in0: 0, in1: 0, in2: 0, onlyFromNoindexOrHubs: 0, inbound: [], depth: { '1-3': 0, '4-5': 0, '6+': 0, unreachable: 0 } })
    const n = inbound.get(path) || 0
    g.pages++
    g.inbound.push(n)
    if (n === 0) g.in0++
    if (n === 1) g.in1++
    if (n === 2) g.in2++
    if (n > 0 && !fromIndexable.get(path)) g.onlyFromNoindexOrHubs++
    const d = depth.get(path)
    g.depth[d === undefined ? 'unreachable' : d <= 3 ? '1-3' : d <= 5 ? '4-5' : '6+']++
  }
  for (const g of Object.values(byGroup)) {
    g.medianInbound = median(g.inbound)
    delete g.inbound
  }
  const top = [...groups.keys()]
    .map((path) => [path, inbound.get(path) || 0])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
  return { groups: byGroup, top, hubs: [...depth.keys()].filter((p) => !groups.has(p)).length }
}

/** A short markdown table for the step summary. */
export function linksMarkdown({ label, report }) {
  const lines = [`### ${label} — internal links (indexable pages)`, '', '| group | pages | 0 in | 1 in | 2 in | median in | only from noindexed/hubs | depth 1-3 | 4-5 | 6+ | unreachable |', '|---|---|---|---|---|---|---|---|---|---|---|']
  for (const [group, g] of Object.entries(report.groups)) {
    lines.push(`| ${group} | ${g.pages} | ${g.in0} | ${g.in1} | ${g.in2} | ${g.medianInbound} | ${g.onlyFromNoindexOrHubs} | ${g.depth['1-3']} | ${g.depth['4-5']} | ${g.depth['6+']} | ${g.depth.unreachable} |`)
  }
  lines.push('', `Top linked: ${report.top.slice(0, 10).map(([p, n]) => `${p} (${n})`).join(', ')}`)
  return lines.join('\n')
}

function readDir(dir, slim) {
  if (!existsSync(dir)) return []
  const out = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      const tab = line.indexOf('\t')
      if (tab > 0) out.push(slim(JSON.parse(line.slice(tab + 1))))
    }
  }
  return out
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : null)).filter(Boolean))
  const label = `${args.label || 'ci'}-links`
  const titles = readDir(join(ROOT, 'public', 'd', 't'), slimTitle)
  const people = readDir(join(ROOT, 'public', 'd', 'c'), slimPerson)
  const report = linkReport(buildGraph(titles, people))
  const json = { kind: 'links', label, titles: titles.length, characters: people.length, report }
  console.log(linksMarkdown(json))
  const dir = join(ROOT, 'tasks', 'measure')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${new Date().toISOString().slice(0, 10)}-${label}.json`), JSON.stringify(json, null, 1))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
