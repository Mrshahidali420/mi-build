#!/usr/bin/env node
/**
 * Measures real rendered pages from a running server (local dev or a tunnel
 * preview), per page type: words, how much of it the site wrote, the skeleton
 * near-duplicate rate and the most repeated sentences. See measure-core.mjs.
 *
 * Run it:
 *   npx astro dev --port 4391 --host 127.0.0.1      (in another terminal)
 *   node scripts/measure-pages.mjs http://127.0.0.1:4391 --label baseline
 * Options: --n 200 (pages per type), --seed 7, --files 40 (shard files read
 *          for the title/character samples), --concurrency 3, --date YYYY-MM-DD
 *
 * Writes tasks/measure/<date>-<label>-pages.json.
 *
 * Page types: title with links, title without, character with bio, without
 * bio, /characters, /like, /free.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sample, summarize } from './measure-core.mjs'
import { loadSample, readShard } from './measure-shards.mjs'
import { sectionOf } from '../src/lib/section.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function args() {
  const out = { _: [] }
  const list = process.argv.slice(2)
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) {
      out._.push(list[i])
      continue
    }
    const next = list[i + 1]
    out[list[i].slice(2)] = next && !next.startsWith('--') ? (i++, next) : true
  }
  return out
}

/** URL paths per page type, seeded, from the shards and the answer-page list. */
function samplePaths({ n, seed, files }) {
  const titles = loadSample({ n: 20000, files, seed })
  const linked = (t) => ((t.kind === 'anime' ? t.watchLinks : t.readLinks) || []).length > 0
  const path = (t) => `/${sectionOf(t)}/${t.slug}`
  const charDir = join(ROOT, 'public', 'd', 'c')
  const charFiles = existsSync(charDir) ? readdirSync(charDir).filter((f) => f.endsWith('.txt')).length : 0
  const people = sample([...Array(charFiles).keys()], Math.min(files, charFiles), seed + 2).flatMap((i) => readShard(i, charDir))
  const hasBio = (p) => String(p.description || '').replace(/[_*~\s]/g, '').length > 40
  let answers = { cast: [], like: [], free: [] }
  try {
    answers = JSON.parse(readFileSync(join(ROOT, 'data', 'answer-urls.json'), 'utf8'))
  } catch {
    console.log('no data/answer-urls.json: skipping /characters, /like and /free')
  }
  return {
    titleWithLinks: sample(titles.filter(linked).map(path), n, seed),
    titleNoLinks: sample(titles.filter((t) => !linked(t)).map(path), n, seed),
    characterWithBio: sample(people.filter(hasBio).map((p) => `/character/${p.slug}`), n, seed),
    characterNoBio: sample(people.filter((p) => !hasBio(p)).map((p) => `/character/${p.slug}`), n, seed),
    characters: sample(answers.cast || [], n, seed),
    like: sample(answers.like || [], n, seed),
    free: sample(answers.free || [], n, seed),
  }
}

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const textOf = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Removes every element with one of the classes, keeping it aside. Not nested-aware past one level of its own tag. */
function takeByClass(html, classes) {
  const taken = []
  let rest = html
  for (const cls of classes) {
    const re = new RegExp(`<(p|div|section)\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, 'g')
    rest = rest.replace(re, (m) => {
      taken.push(m)
      return ' '
    })
  }
  return { rest, taken: taken.join(' ') }
}

/**
 * Splits a page into what the site wrote and what it quotes (the AniList
 * synopsis and the character bio). Only <main> counts: header, footer and
 * menus are the same on every page and say nothing about this one.
 */
export function splitPage(html) {
  const main = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/) || [, html])[1]
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/g, ' ')
  const { rest, taken } = takeByClass(main, ['synopsis', 'dp-bio'])
  const title = decode((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1].replace(/<[^>]+>/g, '')).trim()
  return { site: textOf(rest), other: textOf(taken), names: title ? [title] : [] }
}

async function fetchPage(base, path) {
  try {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) return { path, error: res.status }
    return { path, ...splitPage(await res.text()) }
  } catch (e) {
    return { path, error: e.message }
  }
}

async function fetchAll(base, paths, concurrency) {
  const out = []
  let at = 0
  const worker = async () => {
    while (at < paths.length) {
      const path = paths[at++]
      out.push(await fetchPage(base, path))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

async function main() {
  const a = args()
  const base = String(a._[0] || '').replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) {
    console.error('Usage: node scripts/measure-pages.mjs <base url> [--label x] [--n 200]')
    process.exit(1)
  }
  const n = Number(a.n) || 200
  const seed = Number(a.seed) || 7
  const paths = samplePaths({ n, seed, files: Number(a.files) || 40 })
  const report = {}
  for (const [type, list] of Object.entries(paths)) {
    if (!list.length) continue
    const pages = await fetchAll(base, list, Number(a.concurrency) || 3)
    const ok = pages.filter((p) => !p.error)
    report[type] = { ...summarize(ok), failed: pages.length - ok.length }
    const r = report[type]
    console.log(
      `${type.padEnd(17)} pages ${String(r.pages).padStart(4)} (failed ${r.failed})  words median ${r.medianWords} p10 ${r.p10Words}  site median ${r.medianSiteWords}  site share ${r.siteShare}  near-dup ${r.nearDupRate}  top sentence ${r.topSentences[0]?.share ?? 0}`,
    )
  }
  const date = a.date || new Date().toISOString().slice(0, 10)
  const label = a.label || 'pages'
  const file = join(ROOT, 'tasks', 'measure', `${date}-${label}-pages.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ date, label, base, seed, perType: n, report }, null, 2))
  console.log(`wrote ${file}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
