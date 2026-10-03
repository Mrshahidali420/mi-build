/**
 * The airing week, cut into days.
 *
 * AniList gives every releasing anime the timestamp of its next episode. That
 * one number is the only piece of data on this site that changes by itself,
 * so it is worth a page of its own: the page is different every single day
 * without anybody writing a word.
 *
 * Build-time only in practice (it is fed from catalog.js). It imports only
 * computed.mjs, which the Worker can run too, so it stays cheap to test.
 */
import { nextSlot, startPrecisionOf, startDateText, startWindowEnd } from './computed.mjs'

const DAY = 86400

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Every time on this page is UTC. A visitor in Karachi and a visitor in Texas
 * must see the same HTML, because the page is cached at the edge and served
 * to both. The live countdown in the browser is what makes it personal.
 */
const utcKey = (epoch) => new Date(epoch * 1000).toISOString().slice(0, 10)

/** Groups anime into one bucket per UTC day, soonest day first. */
export function airingDays(airing, nowSec = Date.now() / 1000) {
  const todayKey = utcKey(nowSec)
  const tomorrowKey = utcKey(nowSec + DAY)

  const buckets = new Map()
  for (const show of airing) {
    const key = utcKey(show.nextEpisode.at)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(show)
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, shows]) => {
      const when = new Date(`${key}T00:00:00Z`)
      const weekday = DAY_NAMES[when.getUTCDay()]
      return {
        key,
        // "Today" and "Tomorrow" are what a reader actually wants to see.
        // The weekday stays next to it, so the label is never ambiguous.
        label: key === todayKey ? 'Today' : key === tomorrowKey ? 'Tomorrow' : weekday,
        weekday,
        date: `${weekday}, ${MONTHS[when.getUTCMonth()]} ${when.getUTCDate()}`,
        shows: shows.sort((a, b) => a.nextEpisode.at - b.nextEpisode.at),
      }
    })
}

/**
 * The sentence at the top of the page. It counts what is actually there, so
 * it can never promise a show the list does not hold.
 */
export function scheduleLede(days) {
  const total = days.reduce((sum, day) => sum + day.shows.length, 0)
  if (total === 0) {
    return 'No episode is scheduled in the next seven days. Check back tomorrow — this page is rebuilt every day.'
  }
  const today = days.find((day) => day.label === 'Today')
  const parts = [
    `${total} ${total === 1 ? 'episode airs' : 'episodes air'} in the next seven days, across ${days.length} ${days.length === 1 ? 'day' : 'days'}.`,
  ]
  if (today) {
    parts.push(
      `${today.shows.length} of ${today.shows.length === 1 ? 'them is' : 'them are'} today.`,
    )
  }
  parts.push('Every show below links to the platforms that legally carry it.')
  return parts.join(' ')
}

/* ---------- what is on now, and what is coming ---------------------------- */

/**
 * "Big" means a lot of AniList users already have it on their list. A film
 * gets a lower bar, because films collect fewer list entries than a series
 * with a fan base behind it. Calibrated against AniList's top 50 unreleased
 * anime in September 2026, where ~17,000 was the 50th place.
 */
export const BIG_SERIES_POPULARITY = 30000
export const BIG_MOVIE_POPULARITY = 15000

const SEASON_WORDS = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' }
const FORMAT_WORDS = {
  TV: 'TV series',
  TV_SHORT: 'Short series',
  MOVIE: 'Movie',
  ONA: 'Web series',
  OVA: 'OVA',
  SPECIAL: 'Special',
}

const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0)

/** The premiere as a timestamp, only when AniList gave the exact day. */
export function premiereAt(item) {
  if (startPrecisionOf(item) !== 'day') return null
  const [year, month, day] = item.startDate
  return Date.UTC(year, month - 1, day) / 1000
}

/**
 * Announced and not started. The status is only as fresh as the last build,
 * so a title whose known start window has already closed is left out too.
 */
const stillAhead = (item, nowSec) => {
  if (item.status !== 'NOT_YET_RELEASED') return false
  const end = startWindowEnd(item)
  return end === null || end > nowSec
}

/**
 * When an announced title starts, in the finest words the data supports:
 * "12 Jan 2027", "January 2027", "Winter 2027", "2027", or null.
 */
export function whenText(item) {
  const precision = startPrecisionOf(item)
  if (precision === 'day' || precision === 'month') return startDateText(item)
  if (SEASON_WORDS[item.season] && item.seasonYear) return `${SEASON_WORDS[item.season]} ${item.seasonYear}`
  return startDateText(item)
}

/** "48.6k" — a list count, short enough for a card. */
const shortCount = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n)

/**
 * The rows show a cover 40 pixels wide. AniList keeps a 230-pixel copy in its
 * "medium" folder under the same file name, about five times lighter.
 */
export const smallCover = (url) =>
  url && url.includes('/cover/large/') ? url.replace('/cover/large/', '/cover/medium/') : url

/** One row of an upcoming list: only what the card prints. */
export function upcomingRow(item) {
  return {
    slug: item.slug,
    title: item.title,
    cover: smallCover(item.cover),
    format: FORMAT_WORDS[item.format] || null,
    when: whenText(item),
    at: premiereAt(item),
    lists: item.popularity ? shortCount(item.popularity) : null,
  }
}

/**
 * The homepage's one "Coming up" list: the next episodes of this week and
 * the premieres announced to the day, as one list, soonest first.
 *
 * It used to be two lists, and a show premiering this week sat in both: its
 * first episode is "airing this week" and its premiere is "coming soon". Here
 * each AniList id appears once. When a show is in both, its episode wins,
 * because the episode clock is the exact minute and the premiere only a day.
 *
 *   airing   anime with a next episode this week, soonest first (catalog.js)
 *   dated    unreleased anime with an exact premiere day (upcomingAnime().dated)
 *   airingMax / datedMax   how many of each the list holds at most, so a
 *            busy week never pushes every premiere off the homepage
 *
 * Rows carry only what the list prints: the cover (the small copy), what is
 * coming ("Episode 5", "TV series premiere"), the time for the countdown,
 * and how many platforms stream it.
 */
export function comingUp(airing, dated, { airingMax = 8, datedMax = 6 } = {}) {
  const rows = new Map()
  const add = (show, at, what) =>
    rows.set(show.id, {
      id: show.id,
      slug: show.slug,
      title: show.title,
      cover: smallCover(show.cover),
      at,
      what,
      platforms: (show.watchLinks || []).length,
    })
  for (const show of airing.slice(0, airingMax)) {
    const at = show?.nextEpisode?.at
    if (!at || rows.has(show.id)) continue
    const number = show.nextEpisode.number
    add(show, at, number ? `Episode ${number}` : 'Next episode')
  }
  // datedMax premieres the list does not already hold: a show counted once
  // above does not use up a premiere's place.
  let premieres = 0
  for (const show of dated) {
    if (premieres >= datedMax) break
    const at = premiereAt(show)
    if (!at || rows.has(show.id)) continue
    premieres += 1
    const format = FORMAT_WORDS[show.format]
    add(show, at, format ? `${format} premiere` : 'Premiere')
  }
  return [...rows.values()].sort((a, b) => a.at - b.at || a.id - b.id)
}

/**
 * The most popular shows airing right now, with their next episode when the
 * calendar knows it. nextSlot() is the same clock the title pages use.
 */
export function airingNow(anime, nowSec = Date.now() / 1000, limit = 12) {
  return anime
    .filter((a) => a.status === 'RELEASING')
    .sort(byPopularity)
    .slice(0, limit)
    .map((show) => ({ show, slot: nextSlot(show.nextEpisode, show.status, nowSec) }))
}

/**
 * Everything announced, cut four ways:
 *   anticipated  every unreleased title, most listed first
 *   dated        only titles with an exact announced day, soonest first
 *   big / soon   `dated` split at the popularity bar above
 *   movies       unreleased films, soonest known date first
 */
export function upcomingAnime(anime, nowSec = Date.now() / 1000) {
  const ahead = anime.filter((a) => stillAhead(a, nowSec))
  const isBig = (a) =>
    (a.popularity || 0) >= (a.format === 'MOVIE' ? BIG_MOVIE_POPULARITY : BIG_SERIES_POPULARITY)

  const dated = ahead
    .filter((a) => premiereAt(a) > nowSec)
    .sort((a, b) => premiereAt(a) - premiereAt(b) || byPopularity(a, b))

  const windowEnd = (a) => startWindowEnd(a) ?? Infinity
  const movies = ahead
    .filter((a) => a.format === 'MOVIE')
    .sort((a, b) => windowEnd(a) - windowEnd(b) || byPopularity(a, b))

  return {
    anticipated: [...ahead].sort(byPopularity),
    dated,
    big: dated.filter(isBig),
    soon: dated.filter((a) => !isBig(a)),
    movies,
  }
}
