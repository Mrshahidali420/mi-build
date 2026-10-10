/**
 * BUILD TIME ONLY. Writes the site's own text for every title page.
 *
 * How it works: `facts()` looks at one record and builds every true sentence
 * it can say about it, each with a weight. Rare, distinguishing facts weigh
 * more than common ones (a place in a reading order beats a genre list). The
 * heaviest few become the "at a glance" paragraph that opens the Read / Watch
 * section; the next few become the "in short" paragraph above the synopsis.
 *
 * Which sentences a page gets, and how each one is built, follows from the
 * facts its record holds: a 10-chapter one-volume story is described in a
 * different sentence from a 300-chapter one. There are no synonym swaps and
 * nothing random: the same record always gives the same text.
 *
 * It runs inside scripts/make-shards.mjs on every build, so the Worker does no
 * extra work per request.
 *
 * Rules for anything added here:
 *   1. Never state a fact the record does not hold. No guessing.
 *   2. Never print a tag from BLOCKED_TAGS. Those would cost us AdSense.
 *   3. The title appears at most once per paragraph ("it" after that).
 *   4. No search phrases ("read X online free"). Short and true beats padded.
 */

import { dubOf } from './dub.mjs'
import { factsFor, FREE } from './platform-facts.js'

// Tags that must never reach a page, whatever AniList says about them.
export const BLOCKED_TAGS = new Set([
  'Ecchi', 'Nudity', 'Sexual Content', 'Boys Love', 'Girls Love', 'Yaoi', 'Yuri',
  'Incest', 'Lolicon', 'Shotacon', 'Tentacles', 'Prostitution', 'Rape',
  'Sexual Abuse', 'Netorare', 'Netorase', 'Harem', 'Reverse Harem', 'Fetish',
  'Bondage', 'Cross-Dressing', 'Gender Bending', 'Adult', 'Hentai', 'Erotica',
  'Sex Work', 'Teacher', 'Age Gap', 'Cheating', 'Psychosexual', 'Suicide',
  'Self-Harm', 'Gore', 'Torture', 'Cannibalism', 'Drugs', 'Body Horror',
  'Guro', 'Sadism', 'Masochism', 'Slavery', 'Human Trafficking',
])
const isBlocked = (name) => BLOCKED_TAGS.has(name) || /boys' love|girls' love/i.test(name || '')

const COUNTRY_WORDS = { KR: 'Korean', CN: 'Chinese', TW: 'Taiwanese', JP: 'Japanese' }
const SEASON_WORDS = { WINTER: 'winter', SPRING: 'spring', SUMMER: 'summer', FALL: 'autumn' }
const SECTION_WORDS = { manhwa: 'manhwa', manga: 'manga', manhua: 'manhua', novel: 'novel', anime: 'anime' }
const SHOW_WORDS = {
  TV: 'TV anime',
  TV_SHORT: 'short TV anime',
  MOVIE: 'anime film',
  OVA: 'OVA',
  ONA: 'web anime',
  SPECIAL: 'anime special',
  MUSIC: 'music video',
}
const SOURCE_WORDS = {
  MANGA: 'a manga',
  LIGHT_NOVEL: 'a light novel',
  WEB_NOVEL: 'a web novel',
  NOVEL: 'a novel',
  VISUAL_NOVEL: 'a visual novel',
  VIDEO_GAME: 'a video game',
  GAME: 'a game',
  PICTURE_BOOK: 'a picture book',
}
const REGION_WORDS = { 'Some countries': 'some countries only', 'US and Canada': 'the US and Canada' }
const RELATIVE_WORDS = { SIDE_STORY: ['side story', 'side stories'], SPIN_OFF: ['spin-off', 'spin-offs'], ALTERNATIVE: ['alternative version', 'alternative versions'] }

// How a platform note maps to a bucket a reader actually cares about.
const BUCKET_OF_NOTE = {
  'Free, ad-supported': 'free',
  'Free, official': 'free',
  'Free, official channel': 'free',
  'Free episodes': 'free',
  'Free tier': 'free',
  'Free tier and premium': 'free',
  'Free with timer': 'timer',
  'Free with coins': 'coins',
  'Free with library card': 'library',
  Subscription: 'subscription',
  'Paid chapters': 'paid',
  'Buy in print': 'print',
}

// How much a platform gives away, most generous first.
const FREE_DEPTH = [
  [FREE.ALL, 'has all of it free'],
  [FREE.MOST, 'has most of it free'],
  [FREE.EARLY, 'keeps everything but the newest chapters free'],
  [FREE.SOME, 'gives the first chapters free'],
  [FREE.SOME_EP, 'gives the first episodes free'],
  [FREE.TIMER, 'unlocks one chapter at a time on a free timer'],
]

// The order sentences are printed in, whatever their weight. A reader gets
// "where" before "how much", and the story before the extras.
const ORDER = [
  'where', 'none', 'languages', 'free', 'pay', 'reach', 'account', 'identity', 'adapt', 'chain',
  'relatives', 'run', 'altTitle', 'alias', 'makers', 'dub', 'themes', 'cast', 'chart',
  'rank', 'mal', 'score', 'readers', 'drop', 'favourites', 'rec', 'shape',
]

const GLANCE_MAX = 5
const GLANCE_MIN = 3
const GLANCE_FLOOR = 30
const MORE_MAX = 10

/** "A", then "A and B", then "A, B and C". */
export function joinWords(list) {
  const clean = list.filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  return clean.slice(0, -1).join(', ') + ' and ' + clean[clean.length - 1]
}

const unique = (list) => [...new Set((list || []).filter(Boolean))]
const plural = (n, one, many) => (n === 1 ? one : many)
const big = (n) => Number(n).toLocaleString('en-GB')
const quoted = (text) => `“${text}”`
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a')
const capital = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
const fact = (key, weight, sentence) => ({ key, weight, sentence })

const safeTags = (item, limit) => (item.tags || []).filter((t) => !isBlocked(t)).slice(0, limit)
const safeGenres = (item, limit) => (item.genres || []).filter((g) => !isBlocked(g)).slice(0, limit)

const linksOf = (item, kind) => ((kind === 'anime' ? item.watchLinks : item.readLinks) || []).filter((l) => l && l.site)

/* ------------------------------------------------------------- where to go */

/** Splits a comic's platforms into English ones, other-language ones and unknown ones. */
function splitByLanguage(links) {
  const langsOf = new Map()
  for (const link of links) {
    if (!langsOf.has(link.site)) langsOf.set(link.site, new Set())
    if (link.language) langsOf.get(link.site).add(link.language)
  }
  const english = []
  const other = []
  const unknown = []
  for (const [site, langs] of langsOf) {
    if (langs.has('English')) english.push(site)
    else if (langs.size) other.push([site, [...langs]])
    else unknown.push(site)
  }
  return { english, other, unknown, languages: unique(links.map((l) => l.language)) }
}

const FREE_PHRASE = new Map(FREE_DEPTH)
const PAY_PHRASE = {
  timer: 'unlocks parts free on a wait timer',
  coins: 'runs on coins',
  library: 'is free with a library card',
  subscription: 'needs a subscription',
  paid: 'sells chapters one by one',
  print: 'sells the print edition',
}

/**
 * For a title on one platform only: what that platform gives away, how it is
 * paid, where it works and whether it wants an account, as one clause. It
 * rides on the "where" sentence, which names the title, instead of standing
 * as three short sentences that would read the same on every page.
 */
function siteDetails(site, noteOf) {
  const f = factsFor(site)
  const bucket = noteOf ? BUCKET_OF_NOTE[noteOf(site)] : null
  const region = f.region ? (f.region === 'Worldwide' ? 'works worldwide' : `only serves ${REGION_WORDS[f.region] || f.region}`) : null
  const account = f.account === false ? 'needs no account' : f.account === true ? 'asks you to sign in' : null
  return joinWords([FREE_PHRASE.get(f.free) || null, PAY_PHRASE[bucket] || null, region, account])
}

const withDetails = (sentence, details) => (details ? `${sentence.slice(0, -1)}, which ${details}.` : sentence)

function whereComic(links, noteOf) {
  const { english, other, unknown, languages } = splitByLanguage(links)
  const otherWords = joinWords(other.slice(0, 3).map(([site, langs]) => `${site} in ${joinWords(langs.slice(0, 2))}`))
  const only = unique(links.map((l) => l.site)).length === 1
  const details = only ? siteDetails(links[0].site, noteOf) : ''
  const out = []

  if (english.length && other.length) {
    const more = english.length > 4 ? ` and ${english.length - 4} more` : ''
    out.push(fact('where', 100, `In English, @ is on ${joinWords(english.slice(0, 4))}${more}; ${otherWords} ${other.length === 1 ? 'carries' : 'carry'} it too.`))
  } else if (english.length === 1) {
    out.push(fact('where', 100, withDetails(`@ has one official English home: ${english[0]}.`, details)))
  } else if (english.length > 1 && english.length <= 3) {
    out.push(fact('where', 100, `${joinWords(english)} publish @ officially in English.`))
  } else if (english.length > 3) {
    out.push(fact('where', 100, `${english.length} platforms carry @ in English, among them ${joinWords(english.slice(0, 3))}.`))
  } else if (other.length) {
    out.push(fact('where', 100, withDetails(`There is no official English edition of @ yet, but ${otherWords} ${other.length === 1 ? 'publishes' : 'publish'} it.`, details)))
  }
  if (unknown.length) {
    out.push(
      english.length || other.length
        ? fact('languages', 20, `Also official, language not stated: ${joinWords(unknown.slice(0, 3))}.`)
        : fact('where', 100, withDetails(`@ is officially published on ${joinWords(unknown.slice(0, 3))}.`, details)),
    )
  } else if (languages.length >= 3) {
    out.push(fact('languages', 45, `Official editions exist in ${languages.length} languages: ${joinWords(languages.slice(0, 6))}.`))
  }
  return out
}

function whereAnime(links, noteOf) {
  const sites = unique(links.map((l) => l.site))
  if (sites.length === 1) return fact('where', 100, withDetails(`@ streams officially on one service: ${sites[0]}.`, siteDetails(sites[0], noteOf)))
  if (sites.length <= 4) return fact('where', 100, `${joinWords(sites)} stream @ officially.`)
  return fact('where', 100, `@ streams on ${sites.length} official services, ${joinWords(sites.slice(0, 3))} among them.`)
}

/** No official place yet. How that is said depends on where the story stands. */
function noneFact(item, kind) {
  if (kind === 'anime') {
    const year = item.seasonYear || item.startYear
    if (item.status === 'NOT_YET_RELEASED') return fact('none', 90, 'No service has announced @ yet.')
    if (item.status === 'RELEASING') return fact('none', 90, '@ is airing, but no service we track streams it officially.')
    if (year) return fact('none', 90, `@ first aired in ${year}, and no service we track streams it officially.`)
    return fact('none', 90, 'No streaming service we track carries @ officially.')
  }
  const word = SECTION_WORDS[kind] || 'comic'
  if (item.adapt?.shows?.length && item.status !== 'NOT_YET_RELEASED') {
    return fact('none', 90, `@ has been animated, but the ${word} itself has no official English edition.`)
  }
  if (item.status === 'FINISHED' && item.endYear) return fact('none', 90, `@ ended in ${item.endYear}, and no publisher has released it in English since.`)
  if (item.status === 'RELEASING' && item.startYear) return fact('none', 90, `@ has been coming out since ${item.startYear}, so far with no official English edition.`)
  if (item.status === 'NOT_YET_RELEASED') return fact('none', 90, '@ has not started yet, so no platform carries it.')
  if (item.status === 'HIATUS') return fact('none', 90, '@ is on hiatus and has no official English edition.')
  if (item.status === 'CANCELLED') return fact('none', 90, '@ was cut short before any English publisher picked it up.')
  return fact('none', 90, `We know of no official English edition of @.`)
}

const FREE_NOUN = new Map([
  [FREE.ALL, 'all of it'],
  [FREE.MOST, 'most of it'],
  [FREE.EARLY, 'everything but the newest chapters'],
  [FREE.SOME, 'the first chapters'],
  [FREE.SOME_EP, 'the first episodes'],
  [FREE.TIMER, 'one chapter at a time on a timer'],
])

/** Of several platforms, the one that gives the most away, and how much. */
function freeFact(links) {
  const sites = unique(links.map((l) => l.site))
  for (const [depth] of FREE_DEPTH) {
    const hits = sites.filter((site) => factsFor(site).free === depth)
    if (!hits.length) continue
    const also = hits.length > 1 ? `, as ${hits.length === 2 ? 'does' : 'do'} ${joinWords(hits.slice(1, 3))}` : ''
    return fact('free', 60, `Of its ${sites.length} official platforms, ${hits[0]} gives the most away: ${FREE_NOUN.get(depth)}${also}.`)
  }
  return null
}

/** How you pay, built from which buckets exist. Free sites are left to freeFact when it spoke. */
function payFact(links, kind, noteOf, freeSaid) {
  if (!noteOf) return null
  const buckets = new Map()
  for (const site of unique(links.map((l) => l.site))) {
    const bucket = BUCKET_OF_NOTE[noteOf(site)]
    if (!bucket) continue
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    buckets.get(bucket).push(site)
  }
  if (!buckets.size) return null
  const verb = kind === 'anime' ? 'watch' : 'read'
  const get = (key) => buckets.get(key) || []
  const free = get('free')
  const many = (list, one, more) => `${joinWords(list)} ${list.length > 1 ? more : one}`
  const said = []
  if (get('timer').length) said.push(many(get('timer'), 'unlocks parts free on a wait timer', 'unlock parts free on a wait timer'))
  if (get('coins').length) said.push(many(get('coins'), 'runs on coins', 'run on coins'))
  if (get('library').length) said.push(many(get('library'), 'is free with a library card', 'are free with a library card'))
  if (get('subscription').length) said.push(many(get('subscription'), 'needs a subscription', 'need a subscription'))
  if (get('paid').length) said.push(many(get('paid'), 'sells chapters one by one', 'sell chapters one by one'))
  if (get('print').length) said.push(many(get('print'), 'sells the print edition', 'sell the print edition'))

  if (!said.length) {
    if (freeSaid || !free.length) return null
    return fact('pay', 72, free.length === 1 ? `${free[0]} lets you ${verb} it without paying.` : `All of ${joinWords(free)} let you start without paying.`)
  }
  if (free.length && !freeSaid) return fact('pay', 70, `${many(free, 'costs nothing', 'cost nothing')}, while ${joinWords(said)}.`)
  // freeFact already named what is free, so this only says how the rest is paid.
  if (freeSaid) return fact('pay', 46, `${capital(joinWords(said))}.`)
  if (said.length === 1) return fact('pay', 48, `None is free: ${said[0]}.`)
  return fact('pay', 50, `Nothing here is free to ${verb}. ${capital(joinWords(said))}.`)
}

/** Where in the world the platforms work. */
function reachFact(links) {
  const known = unique(links.map((l) => l.site)).filter((site) => factsFor(site).region)
  if (!known.length) return null
  const regionOf = (site) => REGION_WORDS[factsFor(site).region] || factsFor(site).region
  const world = known.filter((site) => factsFor(site).region === 'Worldwide')
  const local = known.filter((site) => factsFor(site).region !== 'Worldwide')
  const serves = (site) => `${site} serves ${regionOf(site)}`
  if (!local.length) {
    return world.length === 1
      ? fact('reach', 28, `${world[0]} works worldwide.`)
      : world.length === 2
        ? fact('reach', 26, `Both ${world[0]} and ${world[1]} work worldwide.`)
        : fact('reach', 26, `Each of ${joinWords(world.slice(0, 4))} works worldwide.`)
  }
  if (!world.length) {
    return local.length === 1
      ? fact('reach', 42, `${local[0]} only serves ${regionOf(local[0])}.`)
      : fact('reach', 44, `None of them works worldwide: ${joinWords(local.slice(0, 3).map(serves))}.`)
  }
  return fact('reach', 40, `${joinWords(world.slice(0, 3))} ${world.length === 1 ? 'works' : 'work'} worldwide, but ${joinWords(local.slice(0, 2).map(serves))}.`)
}

/** Whether you must sign in, where the platform's own model says so. */
function accountFact(links) {
  const known = unique(links.map((l) => l.site)).filter((site) => typeof factsFor(site).account === 'boolean')
  if (!known.length) return null
  const open = known.filter((site) => factsFor(site).account === false)
  const closed = known.filter((site) => factsFor(site).account === true)
  if (!closed.length) {
    return open.length === 1
      ? fact('account', 24, `You can start on ${open[0]} without an account.`)
      : open.length === 2
        ? fact('account', 24, `Neither ${open[0]} nor ${open[1]} asks you to sign in.`)
        : fact('account', 24, `None of ${joinWords(open.slice(0, 3))} asks you to sign in.`)
  }
  if (!open.length) {
    return closed.length === 1
      ? fact('account', 22, `${closed[0]} asks you to sign in first.`)
      : fact('account', 22, `${closed.length === 2 ? 'Both' : 'All of'} ${joinWords(closed.slice(0, 3))} ask you to sign in.`)
  }
  return fact(
    'account',
    26,
    `${joinWords(open.slice(0, 2))} ${open.length === 1 ? 'works' : 'work'} without an account; ${joinWords(closed.slice(0, 2))} ${closed.length === 1 ? 'asks' : 'ask'} you to sign in.`,
  )
}

/* ------------------------------------------------------------ the story */

function runAnime(item, yearSaid) {
  const what = SHOW_WORDS[item.format]
  const ep = item.episodes
  const start = item.startYear
  const end = item.endYear
  const season = item.season && item.seasonYear ? `${SEASON_WORDS[item.season] || ''} ${item.seasonYear}`.trim() : null
  const when = yearSaid ? null : season || start
  if (item.status === 'FINISHED' && item.format === 'MOVIE') {
    // With no year to add, identityFact already says it is a film.
    return when ? fact('run', 40, `It is an anime film, released in ${when}.`) : null
  }
  if (item.status === 'FINISHED' && ep) {
    if (ep >= 100) {
      const span = start && end && end > start && !yearSaid ? ` between ${start} and ${end}` : ''
      return fact('run', 62, `It is a long run: ${big(ep)} episodes${span}.`)
    }
    if (ep === 1) return when ? fact('run', 34, `Its one episode came out in ${when}.`) : null
    const as = what && what !== 'TV anime' ? ` as ${article(what)} ${what}` : ''
    return fact('run', 42, `All ${ep} episodes aired${when ? ` from ${when}` : ''}${as}.`)
  }
  if (item.status === 'RELEASING') return fact('run', 55, `It is airing now${ep ? `, ${ep} episodes planned` : ''}${when ? `, since ${when}` : ''}.`)
  if (item.status === 'NOT_YET_RELEASED') return fact('run', 58, season ? `It is due to start in ${season}.` : 'It has been announced, with no start date yet.')
  if (item.status === 'CANCELLED') return fact('run', 65, 'It was cancelled before it finished.')
  if (item.status === 'HIATUS') return fact('run', 65, 'It is on a break, with no restart date.')
  return null
}

function runFinished(unit, vol, start, end, yearSaid) {
  const span = start && end && end > start ? end - start : 0
  const volPart = vol ? (vol === 1 ? ' in one volume' : ` across ${vol} volumes`) : ''
  if (unit) {
    if (unit === 1) return fact('run', 40, 'It is a single, complete chapter.')
    if (unit <= 12) return fact('run', 40, `It is a quick read: ${unit} chapters${volPart}, all out.`)
    if (unit < 100) {
      return span && !yearSaid
        ? fact('run', 44, `It finished in ${end} after ${unit} chapters${volPart}, ${span} ${plural(span, 'year', 'years')} after it began.`)
        : fact('run', 42, `It is complete at ${unit} chapters${volPart}.`)
    }
    if (unit < 300) {
      const took = span && !yearSaid ? ` took ${span} ${plural(span, 'year', 'years')} to finish` : ' are all out'
      return fact('run', 50, `Its ${big(unit)} chapters${took}${vol ? `, filling ${vol} volumes` : ''}.`)
    }
    return fact('run', 60, `At ${big(unit)} chapters${vol ? ` and ${vol} volumes` : ''}, it is a long read, and all of it is out.`)
  }
  if (vol) return fact('run', 40, vol === 1 ? 'The whole story fits in one volume.' : `It is finished, collected in ${vol} volumes.`)
  if (yearSaid) return null
  if (span) return fact('run', 34, `It ran from ${start} to ${end} and is finished.`)
  if (start) return fact('run', 30, `It came out in ${start} and is finished.`)
  return fact('run', 26, 'The story is finished.')
}

/** Status against size: "finished at 180 chapters", "on hiatus after 40". */
function runFact(item, kind, yearSaid) {
  if (kind === 'anime') return runAnime(item, yearSaid)
  const ch = item.chapters
  const vol = item.volumes
  const start = item.startYear
  // identityFact says the size of a one-shot or a short finished story.
  if (smallSize(item, kind)) return null
  if (item.status === 'FINISHED') return runFinished(ch, vol, start, item.endYear, yearSaid)
  if (item.status === 'RELEASING') {
    if (ch >= 300) return fact('run', 58, `It is still going after ${big(ch)} chapters.`)
    if (ch) return fact('run', 46, `It is still running, with ${big(ch)} chapters counted so far.`)
    if (yearSaid) return null
    return fact('run', 38, start ? `New chapters have been coming out since ${start}.` : 'New chapters are still coming out.')
  }
  if (item.status === 'HIATUS') return fact('run', 66, `It is on hiatus${ch ? ` after ${big(ch)} chapters` : ''}, with no restart date.`)
  if (item.status === 'CANCELLED') {
    return fact('run', 66, `It was cancelled${ch ? ` at chapter ${big(ch)}` : ''}${item.endYear ? ` in ${item.endYear}` : ''}, before the story ended.`)
  }
  if (item.status === 'NOT_YET_RELEASED') return fact('run', 55, 'It has been announced but has not started yet.')
  return null
}

/** Where this part sits in a series of prequels and sequels. */
function chainFact(item, kind) {
  const chain = item.chain || []
  if (chain.length < 2) return null
  const at = chain.findIndex((part) => part.self)
  if (at < 0) return null
  const verb = kind === 'anime' ? 'watch' : 'read'
  if (at === 0) return fact('chain', 75, `@ opens a ${chain.length}-part series; ${chain[1].title} comes next.`)
  if (at === chain.length - 1) return fact('chain', 75, `@ is the last of ${chain.length} parts, so ${verb} ${chain[0].title} first.`)
  return fact('chain', 75, `@ is part ${at + 1} of ${chain.length}: ${chain[at - 1].title} comes before it and ${chain[at + 1].title} after.`)
}

/** Side stories, spin-offs and alternative versions around it. */
function relativesFact(item) {
  const rels = (item.relations || []).filter((rel) => RELATIVE_WORDS[rel.relation] && rel.title)
  if (!rels.length) return null
  const counts = new Map()
  for (const rel of rels) counts.set(rel.relation, (counts.get(rel.relation) || 0) + 1)
  const parts = [...counts].map(([rel, n]) => `${n === 1 ? article(RELATIVE_WORDS[rel][0]) : n} ${plural(n, ...RELATIVE_WORDS[rel])}`)
  const named = rels.length === 1 ? `, ${rels[0].title}` : `, among them ${rels[0].title}`
  return fact('relatives', 34, `It also has ${joinWords(parts)}${named}.`)
}

function showWords(show) {
  const what = SHOW_WORDS[show.format] || 'anime'
  if (show.format === 'TV' && show.episodes) return `a ${show.episodes}-episode TV anime`
  return `${article(what)} ${what}`
}

/** The anime made from a comic, or the book behind an anime. */
function adaptFact(item, kind, hasLinks) {
  const adapt = item.adapt
  if (kind === 'anime') {
    const src = adapt?.source
    if (!src) return null
    const word = SECTION_WORDS[src.kind] || 'comic'
    const name = same(src.title, item.title) ? `the ${word} of the same name` : `the ${word} ${src.title}`
    const state =
      src.status === 'FINISHED' && src.chapters
        ? `, which finished at ${big(src.chapters)} chapters`
        : src.status === 'RELEASING'
          ? ', which is still running'
          : ''
    const where = src.sites?.length ? `. The ${word} is out in English on ${joinWords(src.sites)}` : ''
    return fact('adapt', 70, `@ adapts ${name}${state}${where}.`)
  }

  const shows = adapt?.shows || []
  if (shows.length) {
    const streamed = shows.find((s) => s.sites?.length)
    const coming = shows.find((s) => s.status === 'NOT_YET_RELEASED')
    if (streamed) {
      const name = same(streamed.title, item.title) ? 'The anime of the same name' : `Its anime, ${streamed.title},`
      const others = shows.length > 1 ? `, one of ${shows.length} screen versions` : ''
      return fact('adapt', hasLinks ? 74 : 86, `${name} streams on ${joinWords(streamed.sites)}${others}.`)
    }
    if (coming && shows.length > 1) {
      const made = shows.length - 1
      return fact('adapt', 80, `It has ${made} screen ${plural(made, 'version', 'versions')} so far, and ${showWords(coming)} has been announced.`)
    }
    if (coming) return fact('adapt', 80, `${capital(showWords(coming))} based on it has been announced.`)
    const first = shows[0]
    if (shows.length === 1) return fact('adapt', 66, `It was made into ${showWords(first)}${first.startYear ? ` in ${first.startYear}` : ''}.`)
    return fact('adapt', 68, `It has ${shows.length} screen versions${first.startYear ? `, the first in ${first.startYear}` : ''}.`)
  }
  if (item.animeInIndex?.length) return fact('adapt', 60, 'There is an anime version of @, with its own page here.')
  return null
}

/** Another name it is listed under, so a reader who knows only that one is sure this is the page. */
function aliasFact(item) {
  const alias = (item.synonyms || []).find(
    (n) => /^[ -~À-ɏ'’!?.,:&()-]+$/.test(n) && !same(n, item.title) && !same(n, item.titleRomaji),
  )
  return alias ? fact('alias', 20, `It is also listed as ${alias.replace(/[.\s]+$/, '')}.`) : null
}

/** Who made it: the author roles for a book, the director and composer for an anime. */
function makersFact(item, kind) {
  if (kind === 'anime') {
    const staff = item.staff || []
    const director = staff.find((s) => s.role === 'Director')?.name
    const music = staff.find((s) => s.role === 'Music')?.name
    // The studio is named in identityFact.
    if (director && music) return fact('makers', 50, `${director} directed it, and ${music} wrote the music.`)
    if (director) return fact('makers', 44, `${director} directed it.`)
    if (music) return fact('makers', 40, `The music is by ${music}.`)
    return null
  }
  const authors = (item.authors || []).filter((a) => a && a.name)
  const roleOf = (a) => String(a.role || '').trim().toLowerCase()
  const names = (list) => joinWords(list.slice(0, 2).map((a) => a.name))
  const both = authors.filter((a) => /^story & (art|illustration)/.test(roleOf(a)))
  const story = authors.filter((a) => roleOf(a) === 'story' || roleOf(a) === 'original story')
  const art = authors.filter((a) => roleOf(a) === 'art' || roleOf(a) === 'illustration')
  if (both.length === 1 && !story.length && !art.length) return fact('makers', 34, `${both[0].name} both writes and draws it.`)
  if (story.length && art.length) return fact('makers', 38, `${names(story)} wrote it and ${names(art)} drew it.`)
  if (kind === 'novel' && story.length) return fact('makers', 34, `${names(story)} wrote it.`)
  return null
}

/** A short comic's size, said inside the identity sentence instead of on its own. */
function smallSize(item, kind) {
  if (kind === 'anime') return null
  if (item.format === 'ONE_SHOT') return 'a single, complete chapter'
  if (item.status !== 'FINISHED') return null
  const ch = item.chapters
  const vol = item.volumes
  const volPart = vol ? (vol === 1 ? ' in one volume' : ` across ${vol} volumes`) : ''
  if (ch === 1) return 'a single, complete chapter'
  if (ch && ch <= 12) return `${ch} chapters${volPart}, all out`
  if (!ch && vol) return vol === 1 ? 'the whole story in one volume' : `finished in ${vol} volumes`
  return null
}

/**
 * What it is: origin, genre, format, source and makers in one sentence, so a
 * record with little else to say still gets a sentence that is its own. A
 * short comic's size rides along here too (runFact then stays quiet).
 */
function identityFact(item, kind, yearSaid, makersSaid) {
  const origin = COUNTRY_WORDS[item.country] || ''
  const oneShot = kind !== 'anime' && item.format === 'ONE_SHOT'
  const word = kind === 'anime' ? SHOW_WORDS[item.format] || 'anime' : oneShot ? `one-shot ${SECTION_WORDS[kind] || 'comic'}` : SECTION_WORDS[kind] || 'comic'
  const genre = joinWords(safeGenres(item, 3).map((g) => g.toLowerCase()))
  const original = kind === 'anime' && item.source === 'ORIGINAL' && !item.adapt?.source
  const lead = [original ? 'original' : '', origin, genre, word].filter(Boolean).join(' ')
  const from = kind === 'anime' ? (item.adapt?.source ? null : SOURCE_WORDS[item.source]) : kind === 'novel' ? null : SOURCE_WORDS[item.source]
  const basedOn = from && from !== 'a manga' ? `, based on ${from}` : ''
  // The makers sentence already names the authors; they are not named twice.
  const by = kind === 'anime' ? (item.studios || []).slice(0, 1) : makersSaid ? [] : unique((item.authors || []).map((a) => a && a.name)).slice(0, 2)
  const year = !yearSaid && item.startYear ? ` from ${item.startYear}` : ''
  const size = smallSize(item, kind)
  const maker = by.length ? (kind === 'anime' ? ` made by ${by[0]}` : ` by ${joinWords(by)}`) : ''
  const phrase = `${article(lead)} ${lead}${maker}${year}${basedOn}`
  const weight = size ? 40 : basedOn || original ? 34 : 22
  // `phrase` lets the "no official edition" sentence carry it as an aside.
  return { ...fact('identity', weight, `@ is ${phrase}${size ? `: ${size}` : ''}.`), phrase: size ? null : phrase }
}

/** The original-language title, when it differs from the one on the page. */
function altTitleFact(item) {
  const romaji = item.titleRomaji
  if (!romaji || same(romaji, item.title) || !COUNTRY_WORDS[item.country]) return null
  const lang = COUNTRY_WORDS[item.country]
  return fact('altTitle', 24, item.country === 'JP' ? `Its Japanese title reads ${romaji}.` : `Its ${lang} title is romanised as ${romaji}.`)
}

function dubFact(item) {
  const dub = dubOf(item)
  if (!dub) return null
  if (dub.state === 'sub') {
    const lead = (item.characters || []).find((c) => c && c.role === 'MAIN' && c.voice)
    return lead
      ? fact('dub', 50, `Only a Japanese cast is listed, with ${lead.voice} as ${lead.name}, so expect subtitles rather than an English dub.`)
      : fact('dub', 50, 'No English dub cast is listed, so expect Japanese audio with subtitles.')
  }
  const first = dub.english[0]
  const count = dub.english.length > 1 ? ` with ${dub.english.length} credited voices` : ''
  return fact('dub', 56, `There is an English dub${count}; ${first.voice} plays ${first.name}.`)
}

function themesFact(item) {
  const themes = item.themes || []
  if (!themes.length) return null
  const first = themes.find((t) => t.type === 'OP') || themes[0]
  const by = (first.artists || []).length ? ` by ${joinWords(first.artists.slice(0, 2))}` : ''
  if (themes.length === 1) return fact('themes', 46, `Its one theme song is ${quoted(first.title)}${by}.`)
  const capped = ['OP', 'ED'].some((type) => themes.filter((t) => t.type === type).length >= 12)
  const role = first.type === 'OP' ? 'opening' : 'ending'
  return fact('themes', 50, `It has ${capped ? `more than ${themes.length}` : themes.length} theme songs; the first ${role} is ${quoted(first.title)}${by}.`)
}

function castFact(item) {
  const cast = (item.characters || []).filter((c) => c && c.name)
  if (!cast.length) return null
  const leads = cast.filter((c) => c.role === 'MAIN').map((c) => c.name).slice(0, 2)
  if (!leads.length) return cast.length >= 5 ? fact('cast', 26, `Its cast list names ${cast.length} characters.`) : null
  if (cast.length <= leads.length) return fact('cast', 34, `The story follows ${joinWords(leads)}.`)
  return fact('cast', 40, `${joinWords(leads)} ${leads.length === 1 ? 'leads' : 'lead'} a cast of ${cast.length} named characters.`)
}

/* -------------------------------------------------------------- reception */

const CHART_WORDS = { POPULAR: 'most popular', RATED: 'highest rated' }

function chartFact(item) {
  const chart = (item.ranks || [])
    .filter((r) => r.allTime && CHART_WORDS[r.type] && r.rank <= 500)
    .sort((a, b) => a.rank - b.rank)[0]
  if (!chart) return null
  return fact('chart', chart.rank <= 100 ? 66 : 46, `@ is #${chart.rank} on AniList's all-time ${CHART_WORDS[chart.type]} chart.`)
}

function scoreFact(item, rank) {
  if (!item.score) return null
  if (rank && rank.top && rank.top <= 25) {
    return fact('rank', rank.top <= 5 ? 48 : 32, `Its AniList score of ${item.score} puts it in the top ${rank.top}% of the ${rank.label} we list.`)
  }
  return fact('score', 20, `AniList members score it ${item.score} out of 100.`)
}

function malFact(item) {
  const mal = item.extra?.mal
  if (!mal || !mal.score) return null
  return fact('mal', 38, `On MyAnimeList it scores ${mal.score}${mal.scoredBy ? ` from ${big(mal.scoredBy)} votes` : ''}.`)
}

function readersFact(item, kind) {
  const r = item.readers || {}
  const done = Number(r.completed) || 0
  const now = Number(r.current) || 0
  const planning = Number(r.planning) || 0
  const dropped = Number(r.dropped) || 0
  if (done < 50 && now < 50 && planning < 50) return null
  const doing = kind === 'anime' ? 'watching' : 'reading'
  const toDo = kind === 'anime' ? 'watch' : 'read'
  const weight = done + now >= 100000 ? 40 : 28
  // Which count is biggest decides what is worth saying.
  const top = Math.max(done, now, planning, dropped)
  if (item.status === 'RELEASING' && now === top) {
    const plan = planning >= 50 ? `, and ${big(planning)} more plan to start` : ''
    return fact('readers', weight, `${big(now)} AniList members are ${doing} it as it comes out${plan}.`)
  }
  if (dropped === top && done >= 50) return fact('readers', weight + 6, `More AniList members dropped it (${big(dropped)}) than finished it (${big(done)}).`)
  if (planning === top && planning > done) {
    return fact(
      'readers',
      weight + 2,
      done >= 50
        ? `It sits on ${big(planning)} AniList plan-to-${toDo} lists, more than the ${big(done)} members who have finished it.`
        : `It sits on ${big(planning)} AniList plan-to-${toDo} lists.`,
    )
  }
  if (now === top && done >= 50) return fact('readers', weight + 4, `More AniList members are ${doing} it now (${big(now)}) than have finished it (${big(done)}).`)
  if (done >= 50) {
    const partway = now >= 50 ? `, and ${big(now)} are partway through` : ''
    return fact('readers', weight, `${big(done)} AniList members have finished it${partway}.`)
  }
  return null
}

/** How many who start it give up, when that number says something. */
function dropFact(item) {
  const r = item.readers || {}
  const dropped = Number(r.dropped) || 0
  const total = (Number(r.completed) || 0) + (Number(r.current) || 0) + (Number(r.paused) || 0) + dropped
  if (total < 1000) return null
  const pct = Math.round((dropped / total) * 100)
  if (pct >= 20) return fact('drop', 30, `${pct}% of the members who started it dropped it.`)
  if (pct <= 3) return fact('drop', 26, `Only ${pct}% of those who start it give up on it.`)
  return null
}

function favouritesFact(item) {
  const fav = Number(item.favourites) || 0
  const done = Number(item.readers?.completed) || 0
  if (fav >= 1000) return fact('favourites', 24, `${big(fav)} members count it among their favourites.`)
  // Few people, but a large share of them loved it: worth saying.
  if (fav >= 20 && done >= 100 && fav * 10 >= done) {
    return fact('favourites', 26, `About one in ${Math.max(2, Math.round(done / fav))} members who finished it marked it a favourite.`)
  }
  return null
}

function recFact(item) {
  const rec = (item.recs || []).find((p) => p && p.title && !same(p.title, item.title))
  if (!rec) return null
  const other = (rec.kind === 'anime') !== (item.kind === 'anime')
  const medium = other ? (rec.kind === 'anime' ? 'the anime ' : 'the book ') : ''
  return fact('rec', 30, `Readers on AniList most often suggest ${medium}${rec.title} after it.`)
}

/** Genres past the two the identity sentence names, and the tags readers add most. */
function shapeFact(item) {
  const genres = safeGenres(item, 5).slice(3).map((g) => g.toLowerCase())
  const tags = safeTags(item, 5).map((t) => t.toLowerCase())
  if (!genres.length && !tags.length) return null
  if (!tags.length) return fact('shape', 14, `It is also filed under ${joinWords(genres)}.`)
  if (!genres.length) return fact('shape', 16, `Readers tag it ${joinWords(tags)}.`)
  return fact('shape', 16, `It is also filed under ${joinWords(genres)}, and readers tag it ${joinWords(tags)}.`)
}

/* ----------------------------------------------------------------- output */

/**
 * Every true sentence this record supports, with its weight. A sentence uses
 * "@" for the title; `render` turns the first one into the title and the rest
 * into "it".
 *
 * @param item   the full catalog record
 * @param kind   'manhwa' | 'manga' | 'manhua' | 'novel' | 'anime'
 * @param noteOf (site) => the platform note string, or null
 * @param rank   { top, label } or null
 * @returns [{ key, weight, sentence }]
 */
export function facts(item, kind, noteOf = null, rank = null) {
  const links = linksOf(item, kind)
  const out = []
  // A year already given by the "no official edition" sentence is not repeated.
  let yearSaid = false
  let none = null
  if (links.length) {
    if (kind === 'anime') out.push(whereAnime(links, noteOf))
    else out.push(...whereComic(links, noteOf))
    // One platform: its details already ride on the "where" sentence.
    if (unique(links.map((l) => l.site)).length > 1) {
      const free = freeFact(links)
      const pay = payFact(links, kind, noteOf, Boolean(free))
      // "How the rest is paid" joins the "who gives most away" sentence.
      out.push(...(free && pay ? [joined(free, pay)] : [free, pay]), reachFact(links), accountFact(links))
    }
  } else {
    none = noneFact(item, kind)
    yearSaid = /\d{4}/.test(none.sentence)
  }
  const run = runFact(item, kind, yearSaid)
  const yearInRun = Boolean(run && item.startYear && run.sentence.includes(String(item.startYear)))
  const makers = makersFact(item, kind)
  let identity = identityFact(item, kind, yearSaid || yearInRun, Boolean(makers))
  // No official place: "X, a Japanese romance manga by Y, ended in 2007, and
  // no publisher has..." One sentence that is this title's own, not two.
  if (none && identity.phrase && none.sentence.startsWith('@ ')) {
    none = fact(none.key, none.weight, `@, ${identity.phrase},${none.sentence.slice(1)}`)
    identity = null
  }
  out.push(
    none,
    adaptFact(item, kind, links.length > 0),
    chainFact(item, kind),
    relativesFact(item),
    run,
    identity,
    altTitleFact(item),
    aliasFact(item),
    makers,
    kind === 'anime' ? dubFact(item) : null,
    kind === 'anime' ? themesFact(item) : null,
    castFact(item),
    chartFact(item),
    scoreFact(item, rank),
    malFact(item),
    ...joinedOrBoth(readersFact(item, kind), dropFact(item)),
    favouritesFact(item),
    recFact(item),
    shapeFact(item),
  )
  return out.filter((f) => f && f.sentence)
}

/** Two facts as one sentence: the first keeps its key and the higher weight. */
function joined(a, b) {
  // A plain opening word is lowered after the semicolon; a name is not.
  const plain = /^(It|Its|Only|More|About)\b/.test(b.sentence)
  const tail = plain ? b.sentence.charAt(0).toLowerCase() + b.sentence.slice(1) : b.sentence
  return fact(a.key, Math.max(a.weight, b.weight), `${a.sentence.slice(0, -1)}; ${tail}`)
}

const joinedOrBoth = (a, b) => (a && b ? [joined(a, b)] : [a, b])

/** Heaviest first; ties keep the reading order, so the choice never wobbles. */
const byWeight = (a, b) => b.weight - a.weight || ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
const byOrder = (a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)

/**
 * Joins sentences and names the title once: at the first "@", or at a leading
 * "It" when that comes first. Every later "@" becomes "it".
 */
export function render(sentences, title) {
  let named = false
  return sentences
    .map((sentence) => {
      if (!named && !sentence.includes('@')) {
        const lead = sentence.match(/^Its?\b/)
        if (lead) {
          named = true
          return `${title}${lead[0] === 'Its' ? "'s" : ''}${sentence.slice(lead[0].length)}`
        }
      }
      return sentence.replace(/@('s)?/g, (match, owner, at) => {
        if (!named) {
          named = true
          return `${title}${owner ? "'s" : ''}`
        }
        const word = owner ? 'its' : 'it'
        return at === 0 ? capital(word) : word
      })
    })
    .join(' ')
}

/**
 * Builds the site's text for one title.
 *
 * @returns { glance, more }
 *   glance  the opening paragraph of Read / Watch (also the meta lede)
 *   more    paragraphs for the "in short" block above the synopsis
 */
export function buildOverview(item, kind, noteOf, rank) {
  const all = facts(item, kind, noteOf, rank).sort(byWeight)
  let take = Math.min(GLANCE_MAX, all.length)
  // Low-weight filler only joins the glance when it would be too short without it.
  while (take > GLANCE_MIN && all[take - 1].weight < GLANCE_FLOOR) take--
  const glance = all.slice(0, take).sort(byOrder)
  const rest = all.slice(take, take + MORE_MAX).sort(byOrder)
  const more = rest.length ? render(rest.map((f) => f.sentence), item.title) : ''
  return {
    glance: render(glance.map((f) => f.sentence), item.title),
    more: more.length > 20 ? [more] : [],
  }
}
