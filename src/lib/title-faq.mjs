/**
 * The FAQ on a title page, and its FAQPage JSON-LD (same list, see faqJsonld
 * in answers.mjs).
 *
 * A question is asked only when this record holds a specific answer to it.
 * "Is it free?" needs platforms whose free part we know; "Has it ended?"
 * needs a year or a count. "Is it on WEBTOON?" is gone: the "where" answer
 * already names every platform, and the per-platform answer read the same on
 * every page that platform carries. A
 * question whose answer would be the same words on every page is left out:
 * it tells the reader nothing and makes every page look alike.
 *
 * Request time, like before: pure string work over one record.
 */
import { factsFor, FREE, PAY } from './platform-facts.js'
import { dubFaq } from './dub.mjs'
import { officialPages } from './alike.mjs'
import { listWords, uniqueBySite, linksOf, verbOf, wordOf, unitOf, rankedRows, episodesWords, songWords } from './answers.mjs'

const FREE_WORDS = {
  [FREE.ALL]: 'has all of it free',
  [FREE.MOST]: 'has most of it free',
  [FREE.EARLY]: 'keeps everything but the newest UNITS free',
  [FREE.SOME]: 'gives the first chapters free',
  [FREE.SOME_EP]: 'gives the first episodes free',
  [FREE.TIMER]: 'unlocks one UNIT at a time on a free timer',
}
export const PAY_WORDS = {
  [PAY.ADS]: 'is free with ads',
  [PAY.COINS]: 'charges coins per chapter',
  [PAY.BUY]: 'sells each chapter',
  [PAY.SUB]: 'needs a monthly plan',
  [PAY.SUB_FREE]: 'has a free tier and a monthly plan',
  [PAY.PRINT]: 'sells the printed book',
  [PAY.LIBRARY]: 'is free with a library card',
}
const SHOW_WORDS = { TV: 'TV anime', TV_SHORT: 'short TV anime', MOVIE: 'anime film', OVA: 'OVA', ONA: 'web anime', SPECIAL: 'anime special' }
const big = (n) => Number(n).toLocaleString('en-GB')
const plural = (n, one, many) => (n === 1 ? one : many)

/** What a platform gives away, with this title's own count where it makes the answer exact. */
export function freeWords(facts, unit, count = 0) {
  if (count > 1 && facts.free === FREE.ALL) return `has all ${big(count)} ${unit} free`
  if (count > 1 && facts.free === FREE.MOST) return `has most of its ${big(count)} ${unit} free`
  if (count > 1 && facts.free === FREE.EARLY) return `keeps all but the newest of its ${big(count)} ${unit} free`
  if (count > 1 && (facts.free === FREE.SOME || facts.free === FREE.SOME_EP)) return `gives the first ${unit} of ${big(count)} free`
  if (count > 1 && facts.free === FREE.TIMER) return `unlocks its ${big(count)} ${unit} one at a time on a free timer`
  return (FREE_WORDS[facts.free] || '').replace('UNITS', unit).replace('UNIT', unit.slice(0, -1))
}

/** "Where can I read X legally?" With links: who carries it, in which language, and the cheapest door. */
function whereQ(item, kind, links) {
  const verb = verbOf(kind)
  const q = `Where can I ${verb} ${item.title} legally?`
  if (links.length) {
    const rows = rankedRows(links)
    const english = rows.filter((r) => kind === 'anime' || r.languages.includes('English')).map((r) => r.link.site)
    const other = rows.filter((r) => kind !== 'anime' && !r.languages.includes('English') && r.languages.length)
    const parts = []
    if (kind === 'anime') parts.push(`On ${listWords(english)}.`)
    else if (english.length) parts.push(`In English, on ${listWords(english)}.`)
    if (other.length) {
      parts.push(`${listWords(other.slice(0, 3).map((r) => `${r.link.site} has it in ${listWords(r.languages.slice(0, 2))}`))}.`)
    }
    const top = rows[0]
    const free = top && freeWords(top.facts, unitOf(kind))
    if (free && rows.length > 1) parts.push(`${top.link.site} is the cheapest way in: it ${free}.`)
    return parts.length ? { q, a: parts.join(' ') } : null
  }
  // No official platform: answer only with something specific to this title.
  const parts = []
  const pages = officialPages(item, 2)
  if (pages.length) {
    parts.push(
      `AniList lists ${listWords(pages.map((p) => (p.language && p.language !== 'English' ? `an official ${p.language} page at ${p.host}` : `an official page at ${p.host}`)))}.`,
    )
  }
  const shows = (item.adapt?.shows || []).filter((s) => s.sites?.length)
  if (shows.length) parts.push(`The anime ${shows[0].title} streams on ${listWords(shows[0].sites)}.`)
  const src = item.adapt?.source
  if (src?.sites?.length) parts.push(`The ${wordOf(src.kind)} it adapts, ${src.title}, is in English on ${listWords(src.sites)}.`)
  // The licensed reads like it have their own block right under this
  // section, so they are not repeated here.
  if (!parts.length) return null
  const first = parts[0].startsWith('AniList') ? parts[0] : parts[0].charAt(0).toLowerCase() + parts[0].slice(1)
  return { q, a: [`We list no official English ${kind === 'anime' ? 'stream' : 'edition'} yet, but ${first}`, ...parts.slice(1)].join(' ') }
}

/** "Is X free?" Only from platforms whose free part or payment we know. */
function freeQ(item, kind, links) {
  const unit = unitOf(kind)
  const rows = uniqueBySite(links).map((l) => ({ site: l.site, facts: factsFor(l.site) }))
  const free = rows.filter((r) => FREE_WORDS[r.facts.free])
  const paid = rows.filter((r) => !FREE_WORDS[r.facts.free] && PAY_WORDS[r.facts.pay])
  if (!free.length && !paid.length) return null
  const count = kind === 'anime' ? item.episodes : item.chapters
  const say = free.slice(0, 3).map((r) => `${r.site} ${freeWords(r.facts, unit, count)}`)
  const pay = paid.slice(0, 2).map((r) => `${r.site} ${PAY_WORDS[r.facts.pay]}`)
  const a = free.length
    ? `In part: ${listWords(say)}.${pay.length ? ` ${listWords(pay)}.` : ''}`
    : `Not on the platforms we list: ${listWords(pay)}.`
  return { q: `Is ${item.title} free to ${verbOf(kind)}?`, a }
}

/** "Has X ended?" Only with a year or a count to back the answer. */
function endedQ(item, kind) {
  const unit = unitOf(kind)
  const count = kind === 'anime' ? item.episodes : item.chapters
  const q = `Has ${item.title} ended?`
  if (item.status === 'FINISHED' && item.endYear) {
    const span = item.startYear && item.endYear > item.startYear ? `, ${item.endYear - item.startYear} ${plural(item.endYear - item.startYear, 'year', 'years')} after it began` : ''
    return { q, a: `Yes, it finished in ${item.endYear}${span}.` }
  }
  if (item.status === 'RELEASING' && item.startYear) {
    return { q, a: `No, it has been coming out since ${item.startYear}${count ? `, with ${big(count)} ${unit} so far` : ''}.` }
  }
  if (item.status === 'HIATUS') return { q, a: `Not yet: it is on hiatus${count ? ` after ${big(count)} ${unit}` : ''}, with no restart date.` }
  if (item.status === 'CANCELLED') return { q, a: `It stopped early: it was cancelled${count ? ` at ${big(count)} ${unit}` : ''}${item.endYear ? ` in ${item.endYear}` : ''}.` }
  return null
}

/** "How many chapters?" The count, with volumes when known. */
function countQ(item, kind) {
  const unit = unitOf(kind)
  const count = kind === 'anime' ? item.episodes : item.chapters
  // A one-shot or a film: "1 chapter" answers nothing anyone asked.
  if (!(count > 1)) return null
  const vols = kind !== 'anime' && item.volumes ? `, collected in ${item.volumes} ${plural(item.volumes, 'volume', 'volumes')}` : ''
  const state = item.status === 'FINISHED' && item.endYear ? `, the last of them out in ${item.endYear}` : item.status === 'RELEASING' ? ' so far' : ''
  return { q: `How many ${unit} does ${item.title} have?`, a: `${big(count)} ${unit}${vols}${state}.` }
}

/** "Who is the main character?" Names, and the voices for an anime. */
function leadQ(item, kind) {
  const leads = (item.characters || []).filter((c) => c.role === 'MAIN' && c.name).slice(0, 3)
  if (!leads.length) return null
  const named = leads.map((c) => (kind === 'anime' && c.voice ? `${c.name} (voiced by ${c.voice})` : c.name))
  return {
    q: `Who is the main character of ${item.title}?`,
    a: leads.length === 1 ? `${named[0]}.` : `It follows ${listWords(named)}.`,
  }
}

/** "Is there an anime?" for a comic; "What is it based on?" for an anime. */
function adaptQ(item, kind) {
  if (kind === 'anime') {
    const src = item.adapt?.source
    if (!src) return null
    const state = src.status === 'FINISHED' && src.chapters ? `, which finished at ${big(src.chapters)} chapters` : src.status === 'RELEASING' ? ', which is still running' : ''
    const where = src.sites?.length ? ` It is out in English on ${listWords(src.sites)}.` : ''
    return { q: `What is ${item.title} based on?`, a: `The ${wordOf(src.kind)} ${src.title}${state}.${where}` }
  }
  const shows = item.adapt?.shows || []
  if (!shows.length) return null
  const first = shows[0]
  const what = first.format === 'TV' && first.episodes ? `a ${first.episodes}-episode TV anime` : `an ${SHOW_WORDS[first.format] || 'anime'}`.replace(/^an ([^aeiouAEIOU])/, 'a $1')
  const when = first.startYear ? ` from ${first.startYear}` : first.status === 'NOT_YET_RELEASED' ? ', announced and not out yet' : ''
  const streamed = shows.find((s) => s.sites?.length)
  const where = streamed ? ` ${streamed === first ? 'It' : streamed.title} streams on ${listWords(streamed.sites)}.` : ''
  const more = shows.length > 1 ? ` ${shows.length} screen versions in all.` : ''
  return { q: `Is there an anime of ${item.title}?`, a: `Yes: ${first.title}, ${what}${when}.${where}${more}` }
}

/** "What order should I read it in?" From the stored reading chain. */
function orderQ(item, kind) {
  const chain = item.chain || []
  if (chain.length < 2) return null
  const names = chain.slice(0, 6).map((p) => p.title)
  const tail = chain.length > 6 ? `, and ${chain.length - 6} more after that` : ''
  return { q: `What order should I ${verbOf(kind)} ${item.title} in?`, a: `${names.join(', then ')}${tail}.` }
}

/** One answer per song kind, from its first song. */
function songQs(item, kind) {
  if (kind !== 'anime' || !Array.isArray(item.themes)) return []
  const out = []
  for (const [type, noun] of [['OP', 'opening'], ['ED', 'ending']]) {
    const rows = item.themes.filter((r) => r.type === type)
    if (!rows.length) continue
    const when = episodesWords(rows[0])
    out.push({
      q: `What is the ${noun} song of ${item.title}?`,
      a:
        (rows.length === 1 ? `${songWords(rows[0])}` : `There are ${rows.length} ${noun} songs. The first is ${songWords(rows[0])}`) +
        `${when ? `, used on ${when}` : ''}.`,
    })
  }
  return out
}

/**
 * The title page FAQ: only questions this record can answer specifically.
 * @returns [{ q, a }]
 */
export function titleFaq(item, kind) {
  const links = linksOf(item)
  return [
    whereQ(item, kind, links),
    links.length ? freeQ(item, kind, links) : null,
    endedQ(item, kind),
    countQ(item, kind),
    adaptQ(item, kind),
    orderQ(item, kind),
    leadQ(item, kind),
    kind === 'anime' ? dubFaq(item) : null,
    ...songQs(item, kind),
  ].filter(Boolean)
}
