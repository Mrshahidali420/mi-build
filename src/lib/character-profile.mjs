/**
 * The "Profile" paragraph on a character page, above the AniList bio.
 *
 * Same approach as the title pages (src/lib/prose.mjs): every fact the record
 * holds becomes one weighted sentence, the strongest few are kept, and they
 * print in a fixed order. No synonyms are swapped and nothing is random, so
 * the same record always gives the same paragraph, and two pages only read
 * alike when their facts are alike.
 *
 * Sources, and nothing else: the character record (appearsIn with its roles,
 * years and voices, costars and vaOther from src/lib/character-facts.mjs,
 * favourites) and the lead title the page has already loaded. No sentence is
 * written without the field behind it.
 *
 * "@" in a sentence is the character: the name the first time, then "he" or
 * "she" when AniList gives a gender, else the name again.
 */
import { sectionOf } from './section.mjs'

export const PROFILE_MAX = 5

const WORDS = { manhwa: 'manhwa', manhua: 'manhua', manga: 'manga', novel: 'novel', anime: 'anime' }
const PLURAL = { novel: 'novels' }
const ROLE = { MAIN: 'main character', SUPPORTING: 'supporting character', BACKGROUND: 'background character' }
const ORDER = ['roles', 'first', 'change', 'voices', 'vaJp', 'vaEn', 'costars', 'lead', 'favourites']

const big = (n) => Number(n).toLocaleString('en-GB')
const esc = (text) =>
  String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/@/g, '&#64;')
const unesc = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&#64;/g, '@').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`
const charLink = (p) => link(`/character/${p.slug}`, p.name)
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a')
const fact = (key, weight, html) => ({ key, weight, html })

export function listWords(list) {
  const clean = list.filter(Boolean)
  if (clean.length < 2) return clean[0] || ''
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`
}

const wordOfRow = (row) => WORDS[sectionOf(row)] || 'manga'
const roleOf = (row) => ROLE[row.role] || 'character'
const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0)
const titled = (row) => `the ${wordOfRow(row)} ${esc(row.title)}`

/** "4 manga and 3 anime", in the order a reader meets them: comics first. */
export function mediaCount(rows) {
  const counts = new Map()
  for (const row of rows) counts.set(wordOfRow(row), (counts.get(wordOfRow(row)) || 0) + 1)
  return listWords(
    [...counts]
      .sort(([a], [b]) => (a === 'anime') - (b === 'anime'))
      .map(([word, n]) => `${n} ${n === 1 ? word : PLURAL[word] || word}`),
  )
}

function rolesFact(rows, story) {
  if (rows.length === 1) {
    // The answer line above already says the role and the title, so this
    // one says what it adds: how the story stands, and that there is no
    // other title.
    const row = rows[0]
    const year = story.state ? `, which ${story.state},` : row.year ? `, from ${row.year},` : ''
    return fact('roles', 90, `${titled(row).replace(/^the/, 'The')}${year} is the only title AniList lists @ in, as ${article(roleOf(row))} ${roleOf(row)}.`)
  }
  const mains = rows.filter((r) => r.role === 'MAIN').length
  const supporting = rows.filter((r) => r.role === 'SUPPORTING').length
  const how =
    mains === rows.length
      ? ', as a main character in every one'
      : mains > 0
        ? `, as a main character in ${mains} of them`
        : supporting === rows.length
          ? ', always in a supporting role'
          : ''
  return fact('roles', 90, `@ appears in ${mediaCount(rows)}${how}.`)
}

function firstFact(rows) {
  const dated = rows.filter((r) => r.year)
  if (rows.length < 2 || !dated.length) return null
  const first = dated.reduce((a, b) => (b.year < a.year ? b : a))
  const last = dated.reduce((a, b) => (b.year > a.year ? b : a))
  const tail = last.year > first.year ? `, and most recently in ${titled(last)} in ${last.year}` : ''
  return fact('first', 70, `@ first turns up in ${titled(first)} in ${first.year}${tail}.`)
}

function changeFact(rows) {
  const main = rows.filter((r) => r.role === 'MAIN').sort(byPopularity)[0]
  const other = rows.filter((r) => r.role && r.role !== 'MAIN').sort(byPopularity)[0]
  if (!main || !other) return null
  return fact('change', 60, `@ leads ${titled(main)} but is ${article(roleOf(other))} ${roleOf(other)} in ${titled(other)}.`)
}

function voicesFact(rows) {
  const jp = [...new Set(rows.map((r) => r.voice).filter(Boolean))]
  const en = [...new Set(rows.map((r) => r.voiceEn).filter(Boolean))]
  if (!jp.length && !en.length) return null
  const voiced = rows.filter((r) => r.voice || r.voiceEn).length
  const across = voiced > 1 ? `Across ${voiced} anime, ` : ''
  const jpPart = jp.length ? `by ${esc(listWords(jp.slice(0, 2)))} in Japanese` : ''
  const enPart = en.length ? `by ${esc(listWords(en.slice(0, 2)))} in the English dub` : ''
  return fact('voices', 75, `${across}@ is voiced ${listWords([jpPart, enPart])}.`)
}

/** The voice the page names: the first row that carries one, as the hero does. */
export const voiceOf = (person, en) => (person.appearsIn || []).find((r) => (en ? r.voiceEn : r.voice))?.[en ? 'voiceEn' : 'voice'] || ''
export const othersOf = (person, en) => (person.vaOther || []).filter((v) => Boolean(v.en) === en)

function vaFact(person, en) {
  const voice = voiceOf(person, en)
  const others = othersOf(person, en)
  if (!voice || !others.length) return null
  const lead = en ? `In English, ${esc(voice)}` : esc(voice)
  return fact(en ? 'vaEn' : 'vaJp', en ? 50 : 55, `${lead} also voices ${listWords(others.map(charLink))}.`)
}

function costarsFact(person) {
  const list = person.costars || []
  if (!list.length) return null
  const [top, ...rest] = list
  const more = rest.length ? `, then ${listWords(rest.map((p) => `${charLink(p)} (${p.n})`))}` : ''
  return fact('costars', 52, `@ shares the most titles with ${charLink(top)}, ${top.n} of them${more}.`)
}

/** How the lead story stands and where it is in English, from the title the page loaded. */
function storyOf(series, lead, links) {
  if (!series || !lead) return { state: '', where: '' }
  const anime = sectionOf(lead) === 'anime'
  const state =
    series.status === 'FINISHED' && series.startYear && series.endYear && series.endYear > series.startYear
      ? `ran from ${series.startYear} to ${series.endYear}`
      : series.status === 'FINISHED' && series.endYear
        ? `came out in ${series.endYear}`
        : series.status === 'RELEASING' && series.startYear
          ? `has been coming out since ${series.startYear}`
          : series.status === 'HIATUS'
            ? 'is on hiatus'
            : ''
  const english = [
    ...new Set(
      (links || [])
        .filter((l) => l && l.site && (anime || !l.language || l.language === 'English'))
        .map((l) => l.site),
    ),
  ].slice(0, 3)
  const where = english.length
    ? anime
      ? `streams on ${esc(listWords(english))}`
      : `is in English on ${esc(listWords(english))}`
    : ''
  return { state, where }
}

function leadFact(rows, lead, story) {
  // One title: its state is already in the roles sentence.
  if (rows.length === 1) return story.where ? fact('lead', 45, `It ${story.where}.`) : null
  if (!story.state && !story.where) return null
  return fact('lead', 45, `${titled(lead).replace(/^the/, 'The')}, where @ comes from, ${listWords([story.state, story.where])}.`)
}

function favouritesFact(person) {
  if (!(person.favourites >= 10)) return null
  return fact('favourites', 25, `@ is on the favourites list of ${big(person.favourites)} AniList members.`)
}

/** Every fact the record can back, unsorted. */
export function profileFacts(person, { series = null, lead = null, links = [] } = {}) {
  const rows = (person.appearsIn || []).filter((r) => r && r.title)
  if (!rows.length) return []
  const story = storyOf(series, lead, links)
  return [
    rolesFact(rows, story),
    firstFact(rows),
    changeFact(rows),
    voicesFact(rows),
    vaFact(person, false),
    vaFact(person, true),
    costarsFact(person),
    leadFact(rows, lead, story),
    favouritesFact(person),
  ].filter(Boolean)
}

/** "@" becomes the name once, then the pronoun AniList's gender gives, else the name. */
function sayName(html, name, gender) {
  const pronoun = gender === 'Male' ? 'he' : gender === 'Female' ? 'she' : ''
  let used = false
  return html.replace(/(^|[.!?]\s+|\s)@/g, (whole, before) => {
    const start = before === '' || /[.!?]\s+$/.test(before)
    if (!used || !pronoun) {
      used = true
      return `${before}${esc(name)}`
    }
    return `${before}${start ? pronoun.charAt(0).toUpperCase() + pronoun.slice(1) : pronoun}`
  })
}

/**
 * The paragraph: the strongest facts, at most PROFILE_MAX, in a fixed order.
 * @returns {{ html: string, text: string, keys: string[] }}
 */
export function characterProfile(person, { name, series = null, lead = null, links = [] } = {}) {
  const chosen = profileFacts(person, { series, lead, links })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, PROFILE_MAX)
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
  if (!chosen.length) return { html: '', text: '', keys: [] }
  const html = sayName(chosen.map((f) => f.html).join(' '), name || person.name, person.gender)
  return { html, text: unesc(html), keys: chosen.map((f) => f.key) }
}
