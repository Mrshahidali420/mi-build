#!/usr/bin/env node
/**
 * Server-free measure of the title page's own text, straight from the title
 * shards in public/d/t. No dev server, no build: it loads a seeded handful of
 * shard files, samples records from them, and rebuilds the site-written text
 * the page would show.
 *
 *   --mode old   the text as the shards hold it today (stored overview, plus
 *                the answer sentence and closing lines the page used to add)
 *   --mode new   the text src/lib/prose.mjs writes now
 *
 * Run it:
 *   node scripts/measure-shards.mjs --mode old --label baseline
 *   node scripts/measure-shards.mjs --mode new --label step1
 * Options: --n 2000 (records), --files 40 (shard files read), --seed 7,
 *          --date YYYY-MM-DD (file name; default today), --dry (print only)
 *
 * Writes tasks/measure/<date>-<label>.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sample, summarize } from './measure-core.mjs'
import { buildOverview } from '../src/lib/prose.mjs'
import { titleAnswer, aboutParagraphs } from '../src/lib/title-answer.mjs'
import { sectionOf } from '../src/lib/section.mjs'
import { PLATFORMS, FALLBACK } from '../src/lib/platforms.js'
import { formatWord, statusWord, platform } from '../src/lib/format.js'
import { coverage, adaptationAnswer, readingOrder } from '../src/lib/computed.mjs'
import * as currentAnswers from '../src/lib/answers.mjs'

// The FAQ text, from today's answers.mjs, or from an older copy named in
// MEASURE_ANSWERS (used once to measure the page as it was before Step 1).
const answers = process.env.MEASURE_ANSWERS
  ? await import(new URL(`file:///${process.env.MEASURE_ANSWERS.replace(/\\/g, '/')}`).href)
  : currentAnswers
import { bucket, titleKey, TITLE_SHARDS } from '../src/lib/shard-key.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARDS = join(ROOT, 'public', 'd', 't')

const noteOf = (site) => (PLATFORMS[site] || FALLBACK).note

export function readShard(n, dir = SHARDS) {
  const file = join(dir, `${n}.txt`)
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const tab = line.indexOf('\t')
    if (tab > 0) out.push(JSON.parse(line.slice(tab + 1)))
  }
  return out
}

/** A seeded set of records from a seeded set of shard files. */
export function loadSample({ n = 2000, files = 40, seed = 7, dir = SHARDS } = {}) {
  const count = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.txt')).length : 0
  if (!count) return []
  const picked = sample([...Array(count).keys()], Math.min(files, count), seed)
  const records = picked.flatMap((i) => readShard(i, dir))
  return sample(records, Math.min(n, records.length), seed + 1)
}

/** One record by section and slug, read from its own shard (cached per file). */
function finder(dir = SHARDS) {
  const cache = new Map()
  return (section, slug) => {
    const key = titleKey(section, slug)
    const n = bucket(key, TITLE_SHARDS)
    if (!cache.has(n)) {
      const file = join(dir, `${n}.txt`)
      cache.set(n, existsSync(file) ? readFileSync(file, 'utf8') : '')
    }
    const text = cache.get(n)
    const at = text.indexOf(`\n${key}\t`)
    if (at < 0) return null
    const end = text.indexOf('\n', at + 1)
    return JSON.parse(text.slice(at + key.length + 2, end))
  }
}

/** Mirrors make-shards.mjs adaptSites, for shards built before that existed. */
function sitesOf(p) {
  if (!p) return null
  const links = p.kind === 'anime' ? p.watchLinks || [] : (p.readLinks || []).filter((l) => l.language === 'English')
  const sites = [...new Set(links.map((l) => l.site).filter(Boolean))].slice(0, 3)
  return sites.length ? sites : null
}

function withAdaptSites(item, find) {
  const adapt = item.adapt
  if (!adapt) return item
  if (adapt.shows) {
    const shows = adapt.shows.map((s) => {
      const sites = s.sites || sitesOf(find('anime', s.slug))
      return sites ? { ...s, sites } : s
    })
    return { ...item, adapt: { ...adapt, shows } }
  }
  if (adapt.source) {
    const sites = adapt.source.sites || sitesOf(find(adapt.source.kind, adapt.source.slug))
    return sites ? { ...item, adapt: { ...adapt, source: { ...adapt.source, sites } } } : item
  }
  return item
}

/** Rank in its section, from the sample itself (the build uses the whole catalog). */
function ranks(records) {
  const groups = new Map()
  for (const r of records) {
    if (!r.score) continue
    const key = sectionOf(r)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const out = new Map()
  for (const [label, list] of groups) {
    list.sort((a, b) => b.score - a.score)
    list.forEach((r, i) => out.set(r.id, { top: Math.max(1, Math.round(((i + 1) / list.length) * 100)), label }))
  }
  return out
}

const linksOf = (item) => ((item.kind === 'anime' ? item.watchLinks : item.readLinks) || [])

/** The answer sentence and closing lines the title page printed before Step 1. */
function oldAnswer(item, word) {
  const isComic = item.kind !== 'anime'
  const links = linksOf(item)
  const names = [...new Set(links.map((l) => l.site))]
  const list = (n) => (n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`)
  const verb = isComic ? 'read' : 'watch'
  const authorPart = item.authors?.length ? ` by ${item.authors.map((a) => a.name).join(', ')}` : ''
  const count = isComic ? item.chapters : item.episodes
  const countPart = count ? ` It has ${count} ${isComic ? 'chapters' : 'episodes'}.` : ''
  const free = [...new Set(links.filter((l) => (platform(l.site).note || '').toLowerCase().includes('free')).map((l) => l.site))]
  const freePart = free.length ? ` ${list(free)} ${free.length === 1 ? 'has' : 'have'} free chapters or a free tier.` : ''
  const status = statusWord(item.status).toLowerCase()
  return names.length
    ? `You can legally ${verb} ${item.title}, a ${status} ${word}${authorPart}, on ${list(names)}.${freePart}${countPart} Every link on this page goes straight to the platform that holds the licence. manhwaindex hosts no chapters and no episodes.`
    : `${item.title} is a ${status} ${word}${authorPart} with no official English ${isComic ? 'publisher' : 'streaming platform'} yet.${countPart} When a licence appears, it is listed here. manhwaindex links only to official platforms and never to unlicensed copies.`
}

const OLD_CHECKED = 'Platforms change their terms, so the platform\'s own page is the last word.'
const oldEmpty = (item) =>
  item.kind !== 'anime'
    ? `No official platform listed yet. No publisher has licensed ${item.title} in a language we track. That usually changes once a series gets popular, so it is worth checking back.`
    : `No official platform listed yet. ${item.title} is not on a streaming platform we track. It may be region-locked or not licensed yet.`

/** Names to mask: the title, its makers, platforms, cast, linked titles. */
function namesOf(item) {
  return [
    item.title,
    item.titleRomaji,
    item.titleNative,
    ...(item.synonyms || []),
    ...(item.authors || []).map((a) => a.name),
    ...(item.staff || []).map((s) => s.name),
    ...(item.studios || []),
    ...linksOf(item).map((l) => l.site),
    ...(item.characters || []).flatMap((c) => [c.name, c.voice, c.voiceEn]),
    ...(item.chain || []).map((p) => p.title),
    ...(item.adapt?.shows || []).flatMap((s) => [s.title, ...(s.sites || [])]),
    ...(item.adapt?.source ? [item.adapt.source.title, ...(item.adapt.source.sites || [])] : []),
    ...(item.recs || []).map((p) => p.title),
    ...(item.themes || []).flatMap((t) => [t.title, ...(t.artists || [])]),
  ].filter(Boolean)
}

const synopsisOf = (item) => String(item.description || '').replace(/\(Source:[^)]*\)/gi, '').replace(/<[^>]+>/g, ' ')

/**
 * The site-written text of one title page, old or new.
 * @returns { site, other, names, hasLinks, section }
 */
export function pageText(item, mode, { rankOf = new Map(), find = () => null } = {}) {
  const section = sectionOf(item)
  const word = item.kind === 'anime' ? 'anime' : formatWord(item)
  const links = linksOf(item)
  const reach = links.length ? coverage(links, section)?.line || '' : ''
  let parts
  if (mode === 'old') {
    const overview = item.overview || {}
    parts = [
      oldAnswer(item, word),
      ...(overview.paragraphs || []),
      links.length ? OLD_CHECKED : oldEmpty(item),
      reach,
    ]
  } else {
    const full = withAdaptSites(item, find)
    const overview = buildOverview(full, section, noteOf, rankOf.get(item.id) || null)
    const page = { ...full, overview }
    // The reach line is no longer printed on title pages (WhereTo titlePage).
    // Nor is the "No official platform listed yet" box: the glance says it.
    parts = [titleAnswer(page, word), ...aboutParagraphs(overview)]
  }
  const own = parts.filter(Boolean).join(' ')
  return {
    site: own,
    // Everything else on the page the site writes from the record: the "best
    // way in" line, the anime/comic and reading-order lines, the FAQ.
    page: [own, ...pageExtras(item, section)].filter(Boolean).join(' '),
    other: synopsisOf(item),
    names: namesOf(item),
    hasLinks: links.length > 0,
    section,
  }
}

function pageExtras(item, section) {
  const links = linksOf(item)
  const verdict = links.length ? answers.bestValue(answers.rankedRows(links), item.kind === 'anime' ? 'anime' : 'comic') : ''
  const bridge = adaptationAnswer(item, section)
  const order = readingOrder(item, section)
  const faq = answers.titleFaq(item, section).flatMap(({ q, a }) => [q, a])
  return [verdict, ...(bridge?.lines || []), order?.line || '', ...faq]
}

export function measureRecords(records, mode) {
  const rankOf = ranks(records)
  const find = finder()
  const rows = records.map((item) => ({ slug: item.slug, ...pageText(item, mode, { rankOf, find }) }))
  const groups = {
    all: () => true,
    titleWithLinks: (r) => r.hasLinks,
    titleNoLinks: (r) => !r.hasLinks,
    anime: (r) => r.section === 'anime',
    novel: (r) => r.section === 'novel',
  }
  const scope = (text) =>
    Object.fromEntries(Object.entries(groups).map(([name, fn]) => [name, summarize(rows.filter(fn).map((r) => ({ ...r, site: text(r) })))]))
  return {
    rows,
    // own: the text this step rewrites (opening paragraph + "in short").
    // page: own plus every other site-written line built from the record.
    report: { own: scope((r) => r.site), page: scope((r) => r.page) },
  }
}

function args() {
  const out = {}
  const list = process.argv.slice(2)
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue
    const key = list[i].slice(2)
    const next = list[i + 1]
    out[key] = next && !next.startsWith('--') ? (i++, next) : true
  }
  return out
}

async function main() {
  const a = args()
  const mode = a.mode === 'old' ? 'old' : 'new'
  const label = a.label || mode
  const records = loadSample({ n: Number(a.n) || 2000, files: Number(a.files) || 40, seed: Number(a.seed) || 7 })
  if (!records.length) {
    console.error('No shards in public/d/t. Run scripts/make-shards.mjs first.')
    process.exit(1)
  }
  const { rows, report } = measureRecords(records, mode)
  const date = a.date || new Date().toISOString().slice(0, 10)
  const out = { date, label, mode, source: 'shards', sample: rows.length, seed: Number(a.seed) || 7, report }
  for (const [scopeName, groups] of Object.entries(report)) {
    for (const [name, r] of Object.entries(groups)) {
      console.log(
        `${scopeName.padEnd(5)}${name.padEnd(15)} pages ${String(r.pages).padStart(5)}  site words median ${r.medianSiteWords} p10 ${r.p10SiteWords}  all words median ${r.medianWords}  site share ${r.siteShare}  near-dup ${r.nearDupRate}  top sentence ${r.topSentences[0]?.share ?? 0}`,
      )
    }
  }
  if (a.dry) return
  const file = join(ROOT, 'tasks', 'measure', `${date}-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`wrote ${file}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
