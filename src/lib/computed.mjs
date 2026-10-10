/**
 * Facts this site works out for itself.
 *
 * Everything here is arithmetic on data we already hold: how many official
 * platforms carry a title, which languages they publish in, how the anime and
 * the comic line up, and the order a series is meant to be read in. None of
 * it is copied from anywhere, and none of it is a guess.
 *
 * Two rules, the same two that govern answers.mjs:
 *   1. It imports platform-facts.js and answers.mjs and NOTHING else, so the
 *      Worker can run it at request time.
 *   2. It never states more than the numbers support. Where a fact would need
 *      a human to check it (which chapter an episode ends on, for example),
 *      the text says what is generally true instead of inventing a number.
 */
import { factsFor, FREE } from './platform-facts.js'
import { uniqueBySite, listWords, wordOf } from './answers.mjs'

const PAID_FREE = new Set([FREE.NONE, FREE.TRIAL])

/**
 * How well a title is served by the official platforms: how many, in what
 * languages, in which parts of the world, and whether any of it is free.
 */
export function coverage(links = [], kind = 'manhwa') {
  const rows = uniqueBySite(links)
  if (rows.length === 0) return null

  const isComic = kind !== 'anime'
  const languages = [...new Set(links.map((l) => l.language).filter(Boolean))].sort()
  const regions = [...new Set(rows.map((l) => factsFor(l.site).region).filter(Boolean))]
  const free = rows.filter((l) => {
    const f = factsFor(l.site).free
    return f && !PAID_FREE.has(f)
  })
  const worldwide = rows.filter((l) => factsFor(l.site).region === 'Worldwide')
  const noAccount = rows.filter((l) => factsFor(l.site).account === false)

  const stats = [
    { label: 'Official platforms', value: String(rows.length) },
    {
      label: 'Free to start',
      value: free.length ? `${free.length} of ${rows.length}` : 'None',
      tone: free.length ? 'good' : 'flat',
    },
    {
      label: 'Works worldwide',
      value: worldwide.length ? `${worldwide.length} of ${rows.length}` : 'None',
      tone: worldwide.length ? 'good' : 'flat',
    },
    {
      label: 'No sign-in needed',
      value: noAccount.length ? `${noAccount.length} of ${rows.length}` : 'None',
      tone: noAccount.length ? 'good' : 'flat',
    },
  ]
  if (isComic) {
    stats.splice(1, 0, {
      label: 'Languages',
      value: languages.length ? String(languages.length) : 'Not listed',
    })
  }

  // The sentence a search engine can lift. It repeats no phrase from the
  // table, because a table is not a sentence.
  const parts = []
  parts.push(
    `${rows.length} official ${rows.length === 1 ? 'platform carries' : 'platforms carry'} it.`,
  )
  if (isComic && languages.length) {
    parts.push(
      languages.includes('English')
        ? `English is one of the ${languages.length} ${languages.length === 1 ? 'language' : 'languages'} on offer: ${listWords(languages)}.`
        : `No English edition yet. The official languages are ${listWords(languages)}.`,
    )
  }
  parts.push(
    free.length
      ? `${free.length} of them ${free.length === 1 ? 'lets' : 'let'} you start without paying.`
      : 'Every one of them asks for money first.',
  )
  if (worldwide.length === 0 && regions.length) {
    parts.push(`None of them is worldwide. They serve ${listWords(regions)}.`)
  }

  return { stats, line: parts.join(' '), languages, free: free.length, total: rows.length }
}

const STATUS_TAIL = {
  RELEASING: 'still releasing',
  NOT_YET_RELEASED: 'not out yet',
  FINISHED: 'finished',
  HIATUS: 'on hiatus',
  CANCELLED: 'cancelled',
}

/**
 * How the anime and the comic line up.
 *
 * We do NOT claim which chapter an episode ends on. Nobody publishes that as
 * data, and a wrong number is worse than no number. We give the counts, the
 * status of each side, and the one thing that is always true: a season is a
 * slice of the comic, so the comic is where the rest of the story lives.
 *
 * `item.adapt` is written by scripts/make-shards.mjs, which has the whole
 * catalog. See that file.
 */
export function adaptationAnswer(item, kind) {
  const adapt = item.adapt
  if (!adapt) return null
  const word = wordOf(kind)

  if (kind === 'anime') {
    const src = adapt.source
    if (!src) return null
    const lines = []
    // Only this pair's own facts: the general lines that used to follow
    // ("one episode carries a few chapters...") read the same on every page.
    const same = String(src.title || '').toLowerCase() === String(item.title || '').toLowerCase()
    lines.push(
      `${item.title} is drawn from the ${wordOf(src.kind)}${same ? ' of the same name' : ` ${src.title}`}${
        src.chapters ? `, which runs to ${src.chapters} chapters` : ''
      } and is ${STATUS_TAIL[src.status] || 'listed'}${
        item.episodes ? `; this anime has ${item.episodes} ${item.episodes === 1 ? 'episode' : 'episodes'}` : ''
      }.`,
    )
    return { heading: `The anime and the ${wordOf(src.kind)}`, lines, link: src }
  }

  const shows = adapt.shows || []
  if (shows.length === 0) return null
  const tv = shows.filter((s) => s.format === 'TV')
  const films = shows.filter((s) => s.format === 'MOVIE')
  const episodes = tv.reduce((sum, s) => sum + (s.episodes || 0), 0)
  const coming = shows.filter((s) => s.status === 'RELEASING' || s.status === 'NOT_YET_RELEASED')

  const lines = []
  const madeOf = []
  if (tv.length) {
    // "series", not "season": AniList lists One Piece as one entry with a
    // thousand episodes, and calling that a season would be wrong.
    madeOf.push(
      `${tv.length} anime series${episodes ? `, ${episodes} episodes in total` : ''}`,
    )
  }
  if (films.length) madeOf.push(`${films.length} ${films.length === 1 ? 'film' : 'films'}`)
  if (madeOf.length) lines.push(`The anime side of ${item.title} is ${listWords(madeOf)}.`)

  if (item.chapters) {
    lines.push(
      `The ${word} runs to ${item.chapters} chapters and is ${STATUS_TAIL[item.status] || 'listed'}.`,
    )
  }
  if (coming.length) {
    lines.push(
      `More is coming: ${listWords(coming.map((s) => s.title))} ${coming.length === 1 ? 'is' : 'are'} ${STATUS_TAIL[coming[0].status]}.`,
    )
  }

  return { heading: `The anime and the ${word}`, lines, shows }
}

/**
 * The order to read or watch a series in.
 *
 * `item.chain` is a straight line of prequels and sequels, worked out at build
 * time by walking the catalog. It exists only when there is more than one
 * part, because a single book has no order.
 */
export function readingOrder(item, kind) {
  const chain = item.chain || []
  if (chain.length < 2) return null
  const word = wordOf(kind)
  const verb = kind === 'anime' ? 'watch' : 'read'
  const at = chain.findIndex((part) => part.self)
  const line =
    at === 0
      ? `${item.title} is where the story starts. ${chain.length - 1} more ${chain.length === 2 ? 'part follows' : 'parts follow'} it.`
      : at === chain.length - 1
        ? `${item.title} is the last part. ${at} ${at === 1 ? 'part comes' : 'parts come'} before it, so ${verb} ${at === 1 ? 'that one' : 'those'} first.`
        : `${item.title} is part ${at + 1} of ${chain.length}. There ${at === 1 ? 'is 1 part' : `are ${at} parts`} before it and ${chain.length - at - 1} after.`
  return { heading: `The order to ${verb} it in`, line, chain, word }
}

/**
 * What is coming next for this title.
 *
 * Four cases, in order of how much a reader cares:
 *   1. An anime page whose own next episode is still ahead.
 *   2. A comic page whose anime has an episode still ahead.
 *   3. A comic page whose anime is announced but not out yet.
 *   4. Any page whose next part in the reading order is not out yet.
 *
 * An episode whose time has passed is never shown. The record is only as
 * fresh as the last daily build, so a past timestamp proves nothing.
 */
const SEASON_WORDS = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * How much of a start date is real: 'day', 'month', 'year', or null.
 *
 * AniList leaves an unknown month or day empty and the ingest stores a 1 in
 * its place, so "January 2027" and "1 January 2027" look the same in
 * startDate. Rows fetched since the ingest learned this carry startPrecision.
 * An older row is read cautiously: a day other than the 1st, or a month other
 * than January, can only have come from AniList, but a 1 proves nothing, so
 * it drops to the coarser part. No false day is ever shown.
 */
export function startPrecisionOf(entry) {
  const [year, month, day] = entry?.startDate || []
  if (!year) return null
  if (entry.startPrecision) return entry.startPrecision
  if (day !== 1) return 'day'
  if (month !== 1) return 'month'
  return 'year'
}

/** The start date in words, never finer than what is known: "12 Jan 2027", "January 2027", "2027". */
export function startDateText(entry) {
  const [year, month, day] = entry?.startDate || []
  const precision = startPrecisionOf(entry)
  if (precision === 'day') return `${day} ${MONTHS[month - 1]} ${year}`
  if (precision === 'month') return `${MONTHS_LONG[month - 1]} ${year}`
  if (precision === 'year') return String(year)
  return null
}

/**
 * The first second after the known part of the start date: the next day,
 * month or year. A title whose window closed before now has already started,
 * whatever its status still says.
 */
export function startWindowEnd(entry) {
  const [year, month, day] = entry?.startDate || []
  const precision = startPrecisionOf(entry)
  if (precision === 'day') return Date.UTC(year, month - 1, day + 1) / 1000
  if (precision === 'month') return Date.UTC(year, month, 1) / 1000
  if (precision === 'year') return Date.UTC(year + 1, 0, 1) / 1000
  return null
}

/**
 * What an announced title can say about its own date, best first:
 *   a full day  -> "premieres on 10 Jan 2027" and a clock that counts down
 *   a month     -> "is announced for January 2027"
 *   a season    -> "is announced for Winter 2027"
 *   a year      -> "is announced for 2027"
 *   nothing     -> "is announced. No air date yet."
 * Only a part of the date AniList actually gave is used. See startPrecisionOf.
 */
export function announced(entry, nowSec = Date.now() / 1000) {
  const [year, month, day] = entry.startDate || []
  const season = SEASON_WORDS[entry.season] && entry.seasonYear
    ? `${SEASON_WORDS[entry.season]} ${entry.seasonYear}`
    : null
  const precision = startPrecisionOf(entry)
  if (precision === 'day') {
    const at = Date.UTC(year, month - 1, day) / 1000
    if (at > nowSec) return { at, text: `premieres on ${startDateText(entry)}.` }
  }
  if (precision === 'month' && startWindowEnd(entry) > nowSec) {
    return { at: null, text: `is announced for ${startDateText(entry)}.` }
  }
  if (season) return { at: null, text: `is announced for ${season}.` }
  const soonYear = year || entry.startYear
  if (soonYear && soonYear >= new Date(nowSec * 1000).getUTCFullYear()) {
    return { at: null, text: `is announced for ${soonYear}.` }
  }
  return { at: null, text: 'is announced. No air date yet.' }
}

const WEEK_SEC = 7 * 24 * 3600
// A weekly show keeps its slot. The catalog refreshes once a day, so the
// stored slot can already be behind us; roll it forward a week at a time,
// but only for a still-airing show and only for a few weeks, so a show on a
// break does not get a made-up timer.
const MAX_ROLL_WEEKS = 3
export function nextSlot(ep, status, nowSec = Date.now() / 1000) {
  if (!ep || !ep.at) return null
  if (ep.at > nowSec) return ep
  if (status !== 'RELEASING') return null
  const weeks = Math.ceil((nowSec - ep.at) / WEEK_SEC)
  if (weeks > MAX_ROLL_WEEKS) return null
  return { at: ep.at + weeks * WEEK_SEC, number: ep.number + weeks }
}

export function upcoming(item, kind, nowSec = Date.now() / 1000) {
  const ahead = (ep) => ep && ep.at > nowSec

  if (kind === 'anime') {
    const slot = nextSlot(item.nextEpisode, item.status, nowSec)
    if (slot) {
      return {
        tag: 'Next episode',
        label: `Episode ${slot.number}`,
        at: slot.at,
        href: '/schedule',
        linkText: 'See the full week',
      }
    }
    if (item.status === 'NOT_YET_RELEASED') {
      const due = announced(item, nowSec)
      return {
        tag: 'Not out yet',
        label: `${item.title} ${due.text}`,
        at: due.at,
        dateOnly: true,
        href: '/schedule',
        linkText: 'See the full week',
      }
    }
  } else {
    const shows = (item.adapt && item.adapt.shows) || []
    const airing = shows
      .map((show) => ({ show, slot: nextSlot(show.nextEpisode, show.status, nowSec) }))
      .filter((x) => x.slot)
      .sort((a, b) => a.slot.at - b.slot.at)[0]
    if (airing) {
      return {
        tag: 'The anime is airing',
        label: `${airing.show.title} episode ${airing.slot.number}`,
        at: airing.slot.at,
        href: `/anime/${airing.show.slug}`,
        linkText: 'Where to watch it',
      }
    }
    const soon = shows.find((show) => show.status === 'NOT_YET_RELEASED')
    if (soon) {
      const due = announced(soon, nowSec)
      return {
        tag: 'An anime is coming',
        label: `${soon.title} ${due.text}`,
        at: due.at,
        dateOnly: true,
        href: `/anime/${soon.slug}`,
        linkText: 'See the show',
      }
    }
  }

  // The next part of the story, when the catalog knows one is on the way.
  const chain = item.chain || []
  const at = chain.findIndex((part) => part.self)
  const next = at >= 0 ? chain[at + 1] : null
  if (next && next.status === 'NOT_YET_RELEASED') {
    const due = announced(next, nowSec)
    return {
      tag: kind === 'anime' ? 'A new season is coming' : 'A new part is coming',
      label: `${next.title} ${due.text}`,
      at: due.at,
      dateOnly: true,
      href: `/${next.kind}/${next.slug}`,
      linkText: 'See it',
    }
  }
  return null
}
