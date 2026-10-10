#!/usr/bin/env node
/**
 * How much of a character page is the site's own writing, and how alike those
 * pages read. The character twin of scripts/measure-shards.mjs, run on the
 * built character shards (public/d/c) with the lead titles from public/d/t.
 *
 *   node scripts/measure-characters.mjs --mode old --label step3-before
 *   node scripts/measure-characters.mjs --mode new --label step3-after
 *
 * old: the page as live before Step 3 (fixed lines plus the old FAQ; point
 *      MEASURE_ANSWERS at a copy of the old src/lib/answers.mjs once its
 *      characterFaq has moved).
 * new: the Profile paragraph, the new answer line and the data-driven FAQ,
 *      with costars, vaOther and years worked out here exactly as
 *      make-shards.mjs does (src/lib/character-facts.mjs).
 *
 * Scopes: own = the text Step 3 rewrites (answer line, profile, FAQ answers);
 * page = own plus the headings and sub-lines around it. The AniList bio is
 * counted as "other", never as the site's own words.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { summarize, sentencesOf, mask } from './measure-core.mjs'
import { bucket, titleKey } from '../src/lib/shard-key.js'
import { sectionOf } from '../src/lib/section.mjs'
import { displayName } from '../src/lib/names.mjs'
import { parseHeight, parseFacts, bioText } from '../src/lib/format.js'
import { faqBio } from '../src/lib/character-page.mjs'
import { attachCharacterFacts } from '../src/lib/character-facts.mjs'
import { characterProfile } from '../src/lib/character-profile.mjs'
import { wordOf, verbOf, uniqueBySite, linksOf } from '../src/lib/answers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHARS = join(ROOT, 'public', 'd', 'c')
const TITLES = join(ROOT, 'public', 'd', 't')
const ROLE = (row) => (row.role === 'MAIN' ? 'main character' : 'character')

function* records(dir) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      const tab = line.indexOf('\t')
      if (tab > 0) yield [line.slice(0, tab), line.slice(tab + 1)]
    }
  }
}

/** Every character, cut down to what the cross-character facts need; the sample in full. */
function loadCharacters(every) {
  const slim = []
  const sampled = new Set()
  for (const [slug, json] of records(CHARS)) {
    const p = JSON.parse(json)
    const keep = bucket(`${slug}#sample`, every) === 0
    if (keep) sampled.add(slim.length)
    slim.push(
      keep
        ? p
        : {
            slug: p.slug,
            name: p.name,
            native: p.native,
            aliases: p.aliases,
            favourites: p.favourites,
            appearsIn: (p.appearsIn || []).map(({ kind, country, slug: s, title, role, popularity, voice, voiceEn }) => ({
              kind, country, slug: s, title, role, popularity, voice, voiceEn,
            })),
          },
    )
  }
  return { slim, sampled }
}

const SLIM_TITLE = (t) => ({
  slug: t.slug, kind: t.kind, country: t.country, title: t.title, status: t.status,
  startYear: t.startYear, endYear: t.endYear, authors: t.authors,
  readLinks: t.readLinks, watchLinks: t.watchLinks, hasAnime: t.hasAnime,
})

/** Start year of every title, and the full lead candidates of the sample. */
function loadTitles(wanted) {
  const years = []
  const found = new Map()
  for (const [key, json] of records(TITLES)) {
    const t = JSON.parse(json)
    if (t.startYear) years.push({ slug: t.slug, kind: t.kind, country: t.country, startYear: t.startYear })
    if (wanted.has(key)) found.set(key, SLIM_TITLE(t))
  }
  return { years, found }
}

const ranked = (rows) => [...rows.filter((a) => a.kind !== 'anime'), ...rows.filter((a) => a.kind === 'anime')]
const orderOf = (person) => {
  const main = person.appearsIn.filter((a) => a.role === 'MAIN')
  return ranked(main.length ? main : person.appearsIn).slice(0, 3)
}
const keyOfRow = (row) => titleKey(sectionOf(row), row.slug)

/** The lead title, chosen as the page chooses it. */
function leadOf(person, found) {
  let lead = orderOf(person)[0]
  let series = null
  let links = []
  for (const row of orderOf(person)) {
    const t = found.get(keyOfRow(row)) || null
    const rows = t ? uniqueBySite(linksOf(t)) : []
    if (!series) { lead = row; series = t; links = rows }
    if (rows.length) { lead = row; series = t; links = rows; break }
  }
  return { lead, series, links }
}

export function pageOf(person, found, mode, faqOf) {
  const { primary } = displayName(person)
  const { lead, series, links } = leadOf(person, found)
  const leadKind = sectionOf(lead)
  const word = wordOf(leadKind)
  const verb = verbOf(leadKind)
  const authors = (series?.authors || []).map((a) => a.name).filter(Boolean).slice(0, 3)
  const by = authors.length ? ` by ${authors.join(' and ')}` : ''
  const height = parseHeight(person.description)
  const { facts: bioFacts, bio } = parseFacts(person.description, { own: {} })
  const bioPlain = bio.trim() ? bioText(bio) : ''
  const short = faqBio(bioPlain)
  const voice = person.appearsIn.find((a) => a.voice)?.voice || ''
  const voiceEn = person.appearsIn.find((a) => a.voiceEn)?.voiceEn || ''
  const faq = faqOf(person, lead, leadKind, series, short, height, voice, bioFacts, voiceEn)
  // The bio quoted inside "Who is X?" is AniList's text, not the site's.
  const answers = faq.map((r) => (short ? r.a.replace(short, '') : r.a)).join(' ')
  const questions = faq.map((r) => r.q).join(' ')
  const opening = `${primary} is a ${ROLE(lead)} in the ${word} ${lead.title}${by}.`
  let own
  let around
  if (mode === 'old') {
    const answer = series
      ? `${opening} Every official place to ${verb} that story is listed below.`
      : `${opening} Checked October 10, 2026.`
    own = [answer, answers]
    around = [
      bio.trim() ? 'From AniList, the same source as the rest of this page.' : '',
      `Where ${primary} shows up`,
      'Open a title to see the official apps that carry it.',
      `Common questions about ${primary}`,
      'Answered from the same facts as the rest of this page.',
    ]
  } else {
    const profile = characterProfile(person, { name: primary, series, lead, links })
    own = [series ? opening : '', profile.text, answers]
    const years = person.appearsIn.map((a) => a.year).filter(Boolean)
    around = [
      bio.trim() ? 'Bio from AniList.' : '',
      `Where ${primary} shows up`,
      years.length && Math.max(...years) > Math.min(...years) ? `From ${Math.min(...years)} to ${Math.max(...years)}.` : '',
      `Common questions about ${primary}`,
    ]
  }
  const site = own.filter(Boolean).join(' ')
  return {
    slug: person.slug,
    site,
    page: [site, questions, ...around].filter(Boolean).join(' '),
    other: bioPlain,
    names: [primary, lead.title, voice, voiceEn, ...authors, ...person.appearsIn.map((a) => a.title), ...(person.costars || []).map((c) => c.name), ...(person.vaOther || []).map((v) => v.name)],
    hasBio: Boolean(bioPlain),
    voiced: Boolean(voice || voiceEn),
    oneTitle: person.appearsIn.length === 1,
    crossMedia: new Set(person.appearsIn.map((a) => a.kind === 'anime')).size > 1,
  }
}

export async function faqFor(mode) {
  if (mode === 'old') {
    const path = process.env.MEASURE_ANSWERS || join(ROOT, 'src', 'lib', 'answers.mjs')
    return (await import(pathToFileURL(path).href)).characterFaq
  }
  return (await import('../src/lib/character-faq.mjs')).characterFaq
}

const GROUPS = {
  all: () => true,
  noBio: (r) => !r.hasBio,
  withBio: (r) => r.hasBio,
  voiced: (r) => r.voiced,
  oneTitle: (r) => r.oneTitle,
  crossMedia: (r) => r.crossMedia,
}

export function report(rows) {
  const scope = (text) =>
    Object.fromEntries(Object.entries(GROUPS).map(([name, fn]) => [name, summarize(rows.filter(fn).map((r) => ({ ...r, site: text(r) })))]))
  const opening = Object.fromEntries(
    Object.entries(GROUPS).map(([name, fn]) => {
      const masked = rows.filter(fn).map((r) => mask(sentencesOf(r.site)[0] || '', r.names))
      const n = new Map()
      for (const s of masked) n.set(s, (n.get(s) || 0) + 1)
      const [sentence, count] = [...n].sort((a, b) => b[1] - a[1])[0] || ['', 0]
      return [name, { sentence, share: Math.round((count / Math.max(1, masked.length)) * 1000) / 1000 }]
    }),
  )
  return { own: scope((r) => r.site), page: scope((r) => r.page), opening }
}

function args() {
  const out = {}
  const list = process.argv.slice(2)
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue
    const next = list[i + 1]
    out[list[i].slice(2)] = next && !next.startsWith('--') ? (i++, next) : true
  }
  return out
}

/** Reads every shard once: the sample (with the new fields in new mode) and its lead titles. */
function loadSample(a, mode) {
  const { slim, sampled } = loadCharacters(Number(a.every) || 85)
  const wanted = new Set()
  for (const i of sampled) for (const row of orderOf(slim[i])) wanted.add(keyOfRow(row))
  const { years, found } = loadTitles(wanted)
  const people = mode === 'new' ? attachCharacterFacts(slim, years) : slim
  // What the new fields add to the character shards, over every page.
  const added = people.reduce((n, p, i) => n + (p === slim[i] ? 0 : JSON.stringify(p).length - JSON.stringify(slim[i]).length), 0)
  const shardBytes = readdirSync(CHARS).reduce((n, f) => n + statSync(join(CHARS, f)).size, 0)
  console.log(`character shards ${shardBytes} bytes; new fields add ${added} bytes over ${people.length} records`)
  const sample = [...sampled].map((i) => people[i])
  if (a.cache) writeFileSync(a.cache, JSON.stringify({ sample, found: [...found] }))
  return { sample, found, shardBytes, added }
}

export const readCache = (file) => {
  const { sample, found } = JSON.parse(readFileSync(file, 'utf8'))
  return { sample, found: new Map(found) }
}

async function main() {
  const a = args()
  const mode = a.mode === 'old' ? 'old' : 'new'
  const { sample, found } = a.cache && existsSync(a.cache) ? readCache(a.cache) : loadSample(a, mode)
  const faqOf = await faqFor(mode)
  const rows = sample.map((person) => pageOf(person, found, mode, faqOf))
  const out = { date: a.date || new Date().toISOString().slice(0, 10), label: a.label || mode, mode, sample: rows.length, report: report(rows) }
  for (const [scopeName, groups] of Object.entries({ own: out.report.own, page: out.report.page })) {
    for (const [name, r] of Object.entries(groups)) {
      console.log(
        `${scopeName.padEnd(5)}${name.padEnd(11)} pages ${String(r.pages).padStart(5)}  site words median ${r.medianSiteWords} p10 ${r.p10SiteWords}  all median ${r.medianWords}  site share ${r.siteShare}  near-dup ${r.nearDupRate}  top ${r.topSentences[0]?.share ?? 0} "${(r.topSentences[0]?.sentence || '').slice(0, 70)}"`,
      )
    }
  }
  for (const [name, o] of Object.entries(out.report.opening)) console.log(`opening ${name.padEnd(11)} ${o.share} "${o.sentence.slice(0, 80)}"`)
  if (a.dry) return
  const file = join(ROOT, 'tasks', 'measure', `${out.date}-${out.label}.json`)
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
