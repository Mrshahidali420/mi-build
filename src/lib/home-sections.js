/**
 * The homepage shelves that report what readers see and open, by one short
 * key each. Shared by the page (src/lib/own-count.js) and the Worker
 * (src/lib/beacon-rows.js), so both sides agree on the same words and a
 * changed page can never widen the table with a new one.
 *
 *   rising, saving, new, month = the self-updating shelves (src/lib/home-plan.mjs)
 *   chars                      = Popular characters right now (by hand)
 *   season                     = New this season (src/lib/season-shelf.mjs)
 *   searching                  = People are searching for (src/lib/home-searching.mjs)
 *
 * A new key goes at the END: home_seen stores the shelves in this order, and
 * a key slotted in the middle would split one set of shelves into two words.
 */
export const HOME_SECTIONS = ['rising', 'saving', 'new', 'month', 'chars', 'season', 'searching']
const KNOWN = new Set(HOME_SECTIONS)

/** One shelf key, or '' when it is not one of ours. */
export function homeSection(value) {
  const key = String(value == null ? '' : value).trim()
  return KNOWN.has(key) ? key : ''
}

/**
 * Add up home_seen and home_click rows ({ name, item, detail, n }) into
 * { seen: { shelf: n }, clicks: Map 'shelf:id' -> n, shelfClicks: { shelf: n } }
 * for /my-admin/homepage. A home_seen row names several shelves at once, so
 * it counts once for each of them.
 */
export function shelfNumbers(rows) {
  const seen = {}
  const clicks = new Map()
  const shelfClicks = {}
  for (const row of rows || []) {
    const n = Number(row?.n) || 0
    if (row?.name === 'home_seen') {
      for (const key of homeSeenDetail(row.detail).split('-').filter(Boolean)) seen[key] = (seen[key] || 0) + n
    } else if (row?.name === 'home_click') {
      const key = homeSection(row.detail)
      if (!key) continue
      const slot = `${key}:${Number(row.item)}`
      clicks.set(slot, (clicks.get(slot) || 0) + n)
      shelfClicks[key] = (shelfClicks[key] || 0) + n
    }
  }
  return { seen, clicks, shelfClicks }
}

/**
 * The shelves seen on one homepage view, as the one word stored in detail:
 * known keys only, each once, always in the order above ("rising-saving").
 * The fixed order keeps the rows few: the same set of shelves is always the
 * same word, so the night job adds them up into one row. '' when none is
 * known, and the row is then not sent.
 */
export function homeSeenDetail(value) {
  const said = new Set(
    (Array.isArray(value) ? value : String(value == null ? '' : value).split('-')).map((k) => String(k).trim())
  )
  return HOME_SECTIONS.filter((key) => said.has(key)).join('-')
}
