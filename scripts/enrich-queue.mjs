/**
 * Which thin character records the next enrich run asks AniList about.
 *
 * Until 23 Oct 2026 every run took the first 3,000 thin records. AniList has
 * no bio for those, so they stayed thin and the same 3,000 were asked again
 * every run: 0 bios gained for weeks while 72,000 others were never asked.
 *
 * Now a record is stamped with the day it was asked (checkedOn). Records never
 * asked go first, then the ones asked longest ago, and a record asked in the
 * last RECHECK_DAYS days waits, so the queue walks all of them. Pure.
 */

export const RECHECK_DAYS = 30

const DAY_MS = 86_400_000

// Every slug ends in the AniList id, so a record saved before we started
// keeping the id separately can still be looked up.
export const idOf = (p) => p.id ?? (Number(String(p.slug || '').match(/-(\d+)$/)?.[1]) || null)

/** Thin: an AniList id and no bio. */
export const isThinRecord = (p) => idOf(p) != null && !p.description

/**
 * @param people every character record
 * @param today 'YYYY-MM-DD'
 * @param limit how many to take this run
 * @returns {object[]} the records to ask about, never-asked first
 */
export function pickThinQueue(people, today, limit) {
  const cutoff = Date.parse(today) - RECHECK_DAYS * DAY_MS
  const due = people.filter((p) => isThinRecord(p) && !(p.checkedOn && Date.parse(p.checkedOn) > cutoff))
  // '' sorts before any date, so never-asked records lead.
  return [...due].sort((a, b) => (a.checkedOn || '').localeCompare(b.checkedOn || '')).slice(0, limit)
}
