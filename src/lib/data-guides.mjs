/**
 * The counting behind the data guides (/guides/<slug> pages built from the
 * catalog, not from Markdown). Every function takes plain arrays of catalog
 * records and returns plain rows, so the pages stay thin and every number on
 * them is tested in tests/data-guides.test.js.
 *
 * No file, no network, no catalog import: the pages pass the records in.
 */
import { freeSplit } from './answers.mjs'
import { COMIC_SECTIONS, sectionOf } from './section.mjs'
import { currentSeason } from './season-core.mjs'
import { adultReason } from './home-plan.mjs'
import { statusWord } from './format.js'

export const ENGLISH = 'English'

const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0)
const keepAll = () => true

/**
 * The official platforms of one title, one row per platform, with every
 * language that platform carries it in: [{ site, languages: ['English'] }].
 * Order is the record's own order. key is 'readLinks' or 'watchLinks'.
 */
export function platformsOf(item, key = 'readLinks') {
  const rows = []
  const bySite = new Map()
  for (const link of item?.[key] || []) {
    if (!link || !link.site) continue
    let row = bySite.get(link.site)
    if (!row) {
      row = { site: link.site, languages: [] }
      bySite.set(link.site, row)
      rows.push(row)
    }
    if (link.language && !row.languages.includes(link.language)) row.languages.push(link.language)
  }
  return rows
}

/** True when a platform row carries the title in English. */
export const isEnglish = (row) => row.languages.includes(ENGLISH)

/** The same platform rows with the English ones first, order otherwise kept. */
export const englishFirst = (rows = []) => [...rows.filter(isEnglish), ...rows.filter((row) => !isEnglish(row))]

/**
 * A keep() for the lists: drops what the homepage keeps off its shelves
 * (adultReason in home-plan.mjs, rules from data/home-rules.json).
 */
export const notAdult = (rules) => (item) => !adultReason(item, rules)

/**
 * The 230-pixel copy of an AniList cover for a list thumbnail. AniList keeps
 * the same file name in its "medium" folder; anything else is left alone.
 */
export const thumbOf = (url) =>
  url && url.includes('/cover/large/') ? url.replace('/cover/large/', '/cover/medium/') : url || null

/** "WEBTOON", or "KakaoPage (Korean)" when the platform has no English edition of it. */
export function platformLabel(row) {
  if (!row.languages.length || isEnglish(row)) return row.site
  return `${row.site} (${row.languages.join(', ')})`
}

/**
 * D1: the most popular titles with at least one free official option, by the
 * same rule as the /<kind>/<slug>/free pages (freeSplit in answers.mjs).
 * Returns [{ item, free: [platform rows], english }], most popular first.
 * english is true when one of the free platforms carries it in English.
 */
export function freeRows(items = [], { limit = 50, keep = keepAll } = {}) {
  const out = []
  for (const item of [...items].sort(byPopularity)) {
    if (out.length >= limit) break
    if (!keep(item)) continue
    const freeSites = new Set(freeSplit(item.readLinks || []).free.map((r) => r.link.site))
    if (freeSites.size === 0) continue
    // English editions first: they are the ones most readers here can open.
    const free = englishFirst(platformsOf(item).filter((row) => freeSites.has(row.site)))
    out.push({ item, free, english: free.some(isEnglish) })
  }
  return out
}

/**
 * How many rows each platform appears in, biggest first:
 * [{ site, count }]. pick(row) returns the platform rows of one row.
 */
export function countPlatforms(rows = [], pick = (row) => row.free) {
  const counts = new Map()
  for (const row of rows) {
    for (const p of pick(row)) counts.set(p.site, (counts.get(p.site) || 0) + 1)
  }
  return [...counts]
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
}

/**
 * D2: this season's anime with their streaming services, most popular first.
 * The season is the build date's, by AniList's months (season-core.mjs).
 * Returns { year, season, rows: [{ item, streams }], unstreamed } where
 * unstreamed counts this season's titles with no legal stream on record.
 */
export function seasonRows(anime = [], { now = new Date(), keep = keepAll } = {}) {
  const { year, season } = currentSeason(now)
  const rows = []
  let unstreamed = 0
  for (const item of anime) {
    if (item.seasonYear !== year || item.season !== season || !keep(item)) continue
    const streams = platformsOf(item, 'watchLinks')
    if (streams.length === 0) unstreamed += 1
    else rows.push({ item, streams })
  }
  rows.sort((a, b) => byPopularity(a.item, b.item))
  return { year, season, rows, unstreamed }
}

/**
 * D3: how many titles each platform carries across the comic sections, one
 * title counted once per platform however many editions it links:
 * [{ site, total, manhwa, manga, manhua, english, top: [up to 3 items] }],
 * biggest first. english counts the titles it carries in English.
 */
export function platformTally(items = [], { topSize = 3 } = {}) {
  const map = new Map()
  for (const item of items) {
    const section = sectionOf(item)
    if (!COMIC_SECTIONS.includes(section)) continue
    for (const p of platformsOf(item)) {
      let row = map.get(p.site)
      if (!row) {
        row = { site: p.site, total: 0, manhwa: 0, manga: 0, manhua: 0, english: 0, top: [] }
        map.set(p.site, row)
      }
      row.total += 1
      row[section] += 1
      if (isEnglish(p)) row.english += 1
      row.top.push(item)
      row.top.sort(byPopularity)
      if (row.top.length > topSize) row.top.length = topSize
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.site.localeCompare(b.site))
}

/**
 * D4: manhwa with and without an official English release.
 * { total, english, otherOnly, none, rows: [{ item, english: [platform rows] }] }
 * total counts every title passed in; english those with at least one
 * platform carrying it in English; otherOnly those with official links in
 * other languages only; none those with no official link at all. rows are
 * the most popular titles with an English platform.
 */
export function englishSplit(items = [], { limit = 50, keep = keepAll } = {}) {
  let english = 0
  let otherOnly = 0
  let none = 0
  const withEnglish = []
  for (const item of items) {
    const platforms = platformsOf(item)
    const en = platforms.filter(isEnglish)
    if (en.length > 0) {
      english += 1
      if (keep(item)) withEnglish.push({ item, english: en })
    } else if (platforms.length > 0) otherOnly += 1
    else none += 1
  }
  withEnglish.sort((a, b) => byPopularity(a.item, b.item))
  return { total: items.length, english, otherOnly, none, rows: withEnglish.slice(0, limit) }
}

/** How many of the most popular titles of a genre the "best" lists rank by score. */
export const BEST_POOL = 100

/**
 * D13-D15: the best titles of one genre on official platforms. The pool is
 * the BEST_POOL most popular titles of the genre that have an official link
 * and a score; the list is that pool ranked by average score, popularity as
 * the tie-break. Returns [{ item, platforms }].
 */
export function bestInGenre(items = [], genre, { pool = BEST_POOL, limit = 30, keep = keepAll } = {}) {
  const candidates = items
    .filter(
      (item) =>
        (item.genres || []).includes(genre) &&
        (item.readLinks || []).length > 0 &&
        (item.score || 0) > 0 &&
        keep(item),
    )
    .sort(byPopularity)
    .slice(0, pool)
  return candidates
    .sort((a, b) => b.score - a.score || byPopularity(a, b))
    .slice(0, limit)
    .map((item) => ({ item, platforms: platformsOf(item) }))
}

/**
 * The one fact line under a title in a list: "Rated 84% · Finished · 2018".
 * Missing parts are left out, never guessed.
 */
export function factLine(item = {}) {
  const parts = []
  if (item.score) parts.push(`Rated ${item.score}%`)
  if (item.status) parts.push(statusWord(item.status))
  if (item.kind === 'anime' && item.episodes) parts.push(`${item.episodes} episodes`)
  if (item.startYear) parts.push(String(item.startYear))
  return parts.join(' · ')
}

/**
 * Up to n guides spread across the hub's groups (groupByCategory in
 * guides.mjs): the first of each group, then the second of each, and so on,
 * so a short row shows the range instead of one category. Guides without
 * an image are skipped.
 */
export function spreadPicks(groups = [], n = 8) {
  const lists = groups.map((g) => (g.guides || []).filter((guide) => guide.image))
  const out = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let round = 0; round < longest && out.length < n; round++) {
    for (const list of lists) {
      if (out.length >= n) break
      if (list[round]) out.push(list[round])
    }
  }
  return out
}

/** "12,345". */
export const num = (n) => Number(n || 0).toLocaleString('en-US')

/** Share of a whole as a whole-number percent, "0%" for an empty whole. */
export const percent = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%')

/** "A, B and C". */
export function listWords(words = []) {
  const list = words.filter(Boolean)
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}
