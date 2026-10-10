/**
 * Title-page facts about where to read or watch: the platforms, how much
 * each gives away, how it is paid, where it works and whether it wants an
 * account, and the "no official place yet" sentence. Used by prose.mjs.
 */

import { factsFor, FREE } from './platform-facts.js'
import {
  SECTION_WORDS,
  REGION_WORDS,
  BUCKET_OF_NOTE,
  FREE_DEPTH,
  joinWords,
  unique,
  capital,
  same,
  fact,
} from './prose-words.mjs'


/** Splits a comic's platforms into English ones, other-language ones and unknown ones. */
export function splitByLanguage(links) {
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

export const FREE_PHRASE = new Map(FREE_DEPTH)
export const PAY_PHRASE = {
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
export function siteDetails(site, noteOf) {
  const f = factsFor(site)
  const bucket = noteOf ? BUCKET_OF_NOTE[noteOf(site)] : null
  const region = f.region ? (f.region === 'Worldwide' ? 'works worldwide' : `only serves ${REGION_WORDS[f.region] || f.region}`) : null
  const account = f.account === false ? 'needs no account' : f.account === true ? 'asks you to sign in' : null
  return joinWords([FREE_PHRASE.get(f.free) || null, PAY_PHRASE[bucket] || null, region, account])
}

export const withDetails = (sentence, details) => (details ? `${sentence.slice(0, -1)}, which ${details}.` : sentence)

export function whereComic(links, noteOf) {
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

export function whereAnime(links, noteOf) {
  const sites = unique(links.map((l) => l.site))
  if (sites.length === 1) return fact('where', 100, withDetails(`@ streams officially on one service: ${sites[0]}.`, siteDetails(sites[0], noteOf)))
  if (sites.length <= 4) return fact('where', 100, `${joinWords(sites)} stream @ officially.`)
  return fact('where', 100, `@ streams on ${sites.length} official services, ${joinWords(sites.slice(0, 3))} among them.`)
}

/** No official place yet. How that is said depends on where the story stands. */
export function noneFact(item, kind) {
  if (kind === 'anime') {
    const year = item.seasonYear || item.startYear
    if (item.status === 'NOT_YET_RELEASED') return fact('none', 90, 'No service has announced @ yet.')
    if (item.status === 'RELEASING') return fact('none', 90, '@ is airing, but no service we track streams it officially.')
    if (year) return fact('none', 90, `@ first aired in ${year}, and no service we track streams it officially.`)
    return fact('none', 90, 'No streaming service we track carries @ officially.')
  }
  // "We list no", never "nobody has": AniList can link an English publisher
  // page that is not a reading platform, and a print licence we do not list
  // may exist. The sentence says what this index holds.
  const word = SECTION_WORDS[kind] || 'comic'
  if (item.adapt?.shows?.length && item.status !== 'NOT_YET_RELEASED') {
    return fact('none', 90, `@ has been animated, but we list no official English edition of the ${word}.`)
  }
  if (item.status === 'FINISHED' && item.endYear) return fact('none', 90, `@ ended in ${item.endYear}, and we list no official English edition of it.`)
  if (item.status === 'RELEASING' && item.startYear) return fact('none', 90, `@ has been coming out since ${item.startYear}, so far with no official English edition that we list.`)
  if (item.status === 'NOT_YET_RELEASED') return fact('none', 90, '@ has not started yet, so no platform carries it.')
  if (item.status === 'HIATUS') return fact('none', 90, '@ is on hiatus, and we list no official English edition of it.')
  if (item.status === 'CANCELLED') return fact('none', 90, '@ was cut short, and we list no official English edition of it.')
  return fact('none', 90, '@ has no official English edition that we list.')
}

export const FREE_NOUN = new Map([
  [FREE.ALL, 'all of it'],
  [FREE.MOST, 'most of it'],
  [FREE.EARLY, 'everything but the newest chapters'],
  [FREE.SOME, 'the first chapters'],
  [FREE.SOME_EP, 'the first episodes'],
  [FREE.TIMER, 'one chapter at a time on a timer'],
])

/** Of several platforms, the one that gives the most away, and how much. */
export function freeFact(links) {
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
export function payFact(links, kind, noteOf, freeSaid) {
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
export function reachFact(links) {
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
export function accountFact(links) {
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

