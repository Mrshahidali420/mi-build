/**
 * Which title the Page poster shares next, and in which format.
 *
 * Mix: about 2 NEW to 1 OLD. After two NEW posts in a row the next is OLD;
 * otherwise NEW, falling back to the other pool when one is empty.
 * Format: never the same format twice in a row; among the rest, the one used
 * least recently goes first.
 * History: a title posted, claimed or failed in the last 30 days is skipped
 * (ledger.mjs holds the same rule as the hard guard).
 * Episodes first: when today's episodes outnumber the posts left today, an
 * episode airing today is picked before anything else (pickUrgent).
 * Covers: a title whose biggest cover is a small file is passed over while a
 * title with a large cover is on offer (image.mjs).
 *
 * Pure: the pools, the history, the clock and the random source are all
 * passed in.
 */
import { FORMATS, buildCaption } from './caption.mjs'
import { preferBigCovers } from './image.mjs'
import { normTitle, TITLE_GAP_DAYS } from './ledger.mjs'

const DAY_MS = 86_400_000
/** The caption format of an episode-today post. */
const URGENT_FORMAT = 'airing'
/** NEW items are taken in pool order (most relevant first) from this many. */
export const NEW_WINDOW = 6
/** OLD items are drawn from this many of the most popular. */
export const OLD_WINDOW = 400
const MAX_TRIES = 60

export function nextMix(history) {
  const last = history.slice(-2).map((e) => e.mix)
  return last.length === 2 && last.every((m) => m === 'new') ? 'old' : 'new'
}

/** Formats for a mix, last-used format removed, least recently used first. */
export function formatOrder(mix, history) {
  const last = history.at(-1)?.format
  const lastUse = (f) => {
    for (let i = history.length - 1; i >= 0; i -= 1) if (history[i].format === f) return i
    return -1
  }
  return Object.keys(FORMATS)
    .filter((f) => FORMATS[f] === mix && f !== last)
    .sort((x, y) => lastUse(x) - lastUse(y))
}

/** Draw from the top of a list, leaning towards the front. */
function draw(list, rng, window) {
  const n = Math.min(list.length, window)
  if (!n) return -1
  return Math.floor(rng() * rng() * n)
}

/**
 * An episode airing today, when the day is short of room: there are at least
 * as many episodes still to air today as posts left today. It goes before the
 * usual mix and the format rotation, most popular first. `pools.today` comes
 * from a site that has an airing schedule; without it this never fires.
 */
export function pickUrgent({ pools, fits, slotsLeft, now, blockedTags = [] }) {
  const today = preferBigCovers((pools.today || []).filter(fits))
  if (!today.length || !(slotsLeft > 0) || today.length < slotsLeft) return null
  for (const candidate of today) {
    const caption = buildCaption(URGENT_FORMAT, candidate, now, blockedTags)
    if (caption) return { candidate, format: URGENT_FORMAT, mix: FORMATS[URGENT_FORMAT], caption }
  }
  return null
}

/**
 * The next post, or null when nothing fits.
 * @param slotsLeft posts still allowed today (leave out to switch the episode priority off)
 * @returns {{ candidate, format, mix, caption } | null}
 */
export function pickNext({ pools, history = [], now, rng = Math.random, skip = new Set(), blockedTags = [], slotsLeft = Infinity }) {
  const since = now - TITLE_GAP_DAYS * DAY_MS
  const recent = new Set(history.filter((e) => e.at >= since).map((e) => normTitle(e.title)))
  const fits = (c) => !recent.has(normTitle(c.title)) && !skip.has(c.slug)
  const urgent = Number.isFinite(slotsLeft) ? pickUrgent({ pools, fits, slotsLeft, now, blockedTags }) : null
  if (urgent) return urgent
  const want = nextMix(history)
  const order = want === 'new' ? ['new', 'old'] : ['old', 'new']

  for (const mix of order) {
    const formats = formatOrder(mix, history)
    if (!formats.length) continue
    const pool = preferBigCovers((pools[mix] || []).filter(fits))
    const tried = new Set()
    for (let i = 0; i < MAX_TRIES && tried.size < pool.length; i += 1) {
      const rest = pool.filter((c) => !tried.has(c.slug))
      const at = mix === 'new' ? Math.min(Math.floor(rng() * Math.min(rest.length, NEW_WINDOW)), rest.length - 1) : draw(rest, rng, OLD_WINDOW)
      if (at < 0) break
      const candidate = rest[at]
      tried.add(candidate.slug)
      for (const format of formats) {
        const caption = buildCaption(format, candidate, now, blockedTags)
        if (caption) return { candidate, format, mix, caption }
      }
    }
  }
  return null
}
