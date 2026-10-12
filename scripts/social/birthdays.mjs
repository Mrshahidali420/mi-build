/**
 * Today's character birthdays, for the birthday card (types/birthday-card.mjs).
 *
 * The catalog holds no birthdays, so this is the one thing the poster asks
 * AniList for: ONE small query per day (the fifty most-favourited characters
 * whose birthday is today). The answer is kept in the ledger
 * (`birthdays: { day, at, list }`), so a chain that posts all day asks once.
 * When the answer holds nobody for this site, it asks again a few hours
 * later, never more often.
 *
 * Never the wrong day: AniList's own idea of "today" is not trusted. Only a
 * character whose birth month and day are today's on the Page's clock (US
 * Eastern, like every other "today" here) is kept, and the list is only
 * ever used on the day it was made for.
 *
 * It fails soft: no answer, a rate limit or a broken answer means no
 * birthday posts this hour and nothing else.
 */
import { dateOf, partsOf, HOUR_MS } from './when.mjs'

export const ANILIST_URL = 'https://graphql.anilist.co'
/** A handful a day at most, the most-favourited first. */
export const MAX_PER_DAY = 5
/** A character fewer people than this have marked as a favourite is not posted. */
export const MIN_FAVOURITES = 100
/** With nobody found, the question is asked again after this long. */
export const RETRY_MS = 3 * HOUR_MS
const TIMEOUT_MS = 15_000
const SAVE_TRIES = 4

export const BIRTHDAY_QUERY = `query {
  Page(page: 1, perPage: 50) {
    characters(isBirthday: true, sort: FAVOURITES_DESC) {
      id
      name { full }
      image { large }
      dateOfBirth { month day }
      favourites
      media(sort: POPULARITY_DESC, perPage: 8) {
        edges { node { id type isAdult } voiceActors(language: JAPANESE) { name { full } } }
      }
    }
  }
}`

/**
 * The characters of an AniList answer whose birthday is `day` ("2026-10-12"),
 * each with the works they appear in: [{ id, name, image, favourites, media: [{ id, voice }] }].
 */
export function birthdaysOf(json, day) {
  const [, month, date] = day.split('-').map(Number)
  return (json?.data?.Page?.characters || [])
    .filter((c) => c?.id && c.name?.full && c.image?.large && !/\/default\./.test(c.image.large) && c.dateOfBirth?.month === month && c.dateOfBirth?.day === date)
    .filter((c) => (c.favourites || 0) >= MIN_FAVOURITES)
    .map((c) => ({
      id: c.id,
      name: c.name.full.trim(),
      image: c.image.large,
      favourites: c.favourites || 0,
      media: (c.media?.edges || []).filter((e) => e?.node?.id && !e.node.isAdult).map((e) => ({ id: e.node.id, voice: e.voiceActors?.[0]?.name?.full || null })),
    }))
    .sort((x, y) => y.favourites - x.favourites)
}

/** Ask AniList. Throws on anything but a clean answer. */
export async function fetchBirthdays(day, { fetch = globalThis.fetch } = {}) {
  const res = await fetch(ANILIST_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query: BIRTHDAY_QUERY }), signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`AniList answered ${res.status}`)
  const json = await res.json()
  if (json.errors?.length) throw new Error(`AniList: ${json.errors[0].message}`)
  return birthdaysOf(json, day)
}

/** True when the kept answer is for this day and still good to use. */
export const isFresh = (kept, day, now) => Boolean(kept && kept.day === day && (kept.list?.length > 0 || now - (kept.at || 0) < RETRY_MS))

async function keep(book, value) {
  for (let i = 0; i < SAVE_TRIES; i += 1) {
    const { data, version } = await book.read()
    if (await book.write({ ...data, birthdays: value }, version, `Birthdays ${value.day}`)) return true
  }
  return false
}

/**
 * Today's birthdays for this site: { day, at, list }, from the ledger when
 * it has them, else from AniList (and then written to the ledger).
 * @param choose (character) => { mediaId, voice } | null: the work of this
 *   character that has a live page on this site, or null to leave them out
 * @returns { day, list: [{ id, name, image, favourites, mediaId, voice }] }; an empty list on any failure
 */
export async function loadBirthdays({ book, now, choose, fetch = globalThis.fetch, say = () => {} }) {
  const day = dateOf(now)
  try {
    const kept = (await book.read()).data.birthdays
    if (isFresh(kept, day, now)) return { day, list: kept.list || [] }
    const list = (await fetchBirthdays(day, { fetch }))
      .map((c) => ({ c, pick: choose(c) }))
      .filter(({ pick }) => pick)
      .slice(0, MAX_PER_DAY)
      .map(({ c, pick }) => ({ id: c.id, name: c.name, image: c.image, favourites: c.favourites, mediaId: pick.mediaId, voice: pick.voice || null }))
    await keep(book, { day, at: now, list })
    say(`Birthdays for ${day}: ${list.length} with a page on this site (asked AniList once).`)
    return { day, list }
  } catch (error) {
    say(`Birthdays could not be read (${error.message}). No birthday posts for now.`)
    return { day, list: [] }
  }
}

/** "OCTOBER 12" for a day string, in capitals. */
export function birthdayLabel(now) {
  const { month, day } = partsOf(now)
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1]} ${day}`
}

/**
 * loadPools with today's birthdays added to its data, for a run whose
 * switched-on kinds include one that wants them (a kind with `birthdays`).
 */
export function withBirthdays(loadPools, kinds, { book, fetch, say }) {
  const kind = kinds.find((k) => k && typeof k !== 'string' && k.birthdays)
  if (!kind) return loadPools
  return async (options = {}) => {
    const loaded = await loadPools(options)
    const now = options.now ?? Date.now()
    const birthdays = await loadBirthdays({ book, now, choose: kind.birthdays(loaded.data), fetch, say })
    return { ...loaded, data: { ...loaded.data, birthdays } }
  }
}
