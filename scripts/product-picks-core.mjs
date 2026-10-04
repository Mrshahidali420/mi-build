/**
 * The rules that turn publisher records into product picks, pure, so the
 * tests can hand in their own records. scripts/picks-from-products.mjs runs
 * them on the amazon-products crawl.
 *
 * The crawl looked up the most read titles in publisher and library records
 * (Open Library and the like) and wrote down every official English product
 * it could tie to an Amazon ASIN. From that, each title gets at most three
 * picks: volume 1, one box set and one disc. A reader on a title page wants
 * the place to start, not a shelf of forty volumes.
 *
 * Only what the site needs is kept: { a, n, t }, the same shape as the hand
 * picks. No price, no tag and no disclosure text: the price is Amazon's to
 * show, the tag is added when the link is drawn (src/lib/picks.js), and the
 * Associates sentence lives in the footer and on /privacy only.
 */

// Past this length the card wraps to four lines on a phone, so the name is
// cut at a word. Same limit as the hand picks (scripts/build-picks.mjs).
export const NAME_MAX = 70
export const MAX_PICKS = 3

// A book's ASIN is its ISBN-10: nine digits and a digit or X. Anything else
// Amazon sells has an ASIN of B and nine letters or digits.
const ISBN10 = /^\d{9}[\dX]$/
const B_ASIN = /^B[0-9A-Z]{9}$/

const VOLUME_TYPES = new Set(['volume', 'light-novel'])
const BOX_TYPES = new Set(['box-set'])
// Blu-ray first: it is what most buyers look for when both exist.
const DISC_RANK = { 'blu-ray': 0, dvd: 1 }
// Every product type the crawl files as a printed book.
const BOOK_TYPES = new Set([...VOLUME_TYPES, ...BOX_TYPES])

const CONFIDENCE_RANK = { high: 0, medium: 1 }

/**
 * True for an ASIN Amazon could have issued. An ISBN-10 must also pass its
 * own check digit, which catches the typos a record can carry: a wrong digit
 * would send the reader to some other book.
 */
export function validAsin(asin) {
  const value = String(asin || '').toUpperCase()
  if (B_ASIN.test(value)) return true
  if (!ISBN10.test(value)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) sum += (10 - i) * (value[i] === 'X' ? 10 : Number(value[i]))
  return sum % 11 === 0
}

// Written by its code point, so this file itself holds no long dash.
const LONG_DASH = new RegExp(String.fromCharCode(0x2014), 'g')

/**
 * A name for the card: one line of plain words, cut at a word when long. A
 * long dash in a shop title becomes a plain hyphen, the site's own style.
 */
export function cleanName(name) {
  const clean = String(name || '').replace(LONG_DASH, '-').replace(/\s+/g, ' ').trim()
  if (clean.length <= NAME_MAX) return clean
  const cut = clean.slice(0, NAME_MAX)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,:;\-–(]+$/, '') + '…'
}

const confidence = (r) => CONFIDENCE_RANK[r.confidence] ?? 9

// Many records carry no volume number but say it in the name: "Attack On
// Titan 1", "Akira, Vol. 1", "Attack on Titan. 29". Without this, a record of
// volume 2 that did carry its number beat the unnumbered volume 1.
const VOLUME_IN_NAME = /\b(?:vol(?:ume)?\.?|tomo?|#)\s*(\d{1,3})\b|[\s.,]\s*(\d{1,3})\s*$/i
function volumeNumber(r) {
  if (Number.isFinite(r.volume_number)) return r.volume_number
  const m = String(r.name || '').match(VOLUME_IN_NAME)
  return m ? Number(m[1] || m[2]) : Infinity
}

// The lowest volume number first, and among copies of the same volume the one
// the crawl was surest of.
const byVolume = (x, y) => volumeNumber(x) - volumeNumber(y) || confidence(x) - confidence(y)
const bySureness = (x, y) => confidence(x) - confidence(y)
const byDisc = (x, y) => DISC_RANK[x.product_type] - DISC_RANK[y.product_type] || confidence(x) - confidence(y)

const pickOf = (record, t) => ({ a: String(record.amazon_asin).toUpperCase(), n: cleanName(record.name), t })

/** The picks for one title's records: volume 1, a box set, a disc. */
export function picksOfRecords(records, ebooks = new Set()) {
  const usable = records.filter(
    (r) => validAsin(r.amazon_asin) && cleanName(r.name).length > 0 && !ebooks.has(String(r.amazon_asin).toUpperCase())
  )
  const first = usable.filter((r) => VOLUME_TYPES.has(r.product_type)).sort(byVolume)[0]
  const box = usable.filter((r) => BOX_TYPES.has(r.product_type)).sort(bySureness)[0]
  const disc = usable.filter((r) => r.product_type in DISC_RANK).sort(byDisc)[0]
  const picks = []
  const seen = new Set()
  for (const [record, t] of [[first, 'book'], [box, 'book'], [disc, 'disc']]) {
    if (!record) continue
    const pick = pickOf(record, t)
    if (seen.has(pick.a)) continue
    seen.add(pick.a)
    picks.push(pick)
  }
  return picks.slice(0, MAX_PICKS)
}

/**
 * The whole file: picks per title, and the titles that were checked and have
 * no English print at all.
 *
 *   records      every product record of the crawl (products/all.json)
 *   checkedIds   the AniList ids the crawl looked up (products/title-list.json)
 *   handTitles   the hand picks' `titles` (data/picks.json). A title picked by
 *                hand is left out here, so the hand picks always win.
 *   sites        which records belong to this site ("both" is shared)
 *   ebooks       ISBNs Open Library lists as eBook editions
 *                (data/pick-isbn-formats.json). A Kindle book sells under a
 *                B0 ASIN, so /dp/<eBook ISBN> is a 404 and such a record is
 *                never a pick.
 *
 * A title with book records but no usable ASIN is NOT listed as having no
 * English books: the books exist, only the link to them is missing, so its
 * search row still finds them.
 */
export function buildProductPicks({ records, checkedIds, handTitles = {}, sites, ebooks = [] }) {
  const skip = new Set([...ebooks].map((a) => String(a).toUpperCase()))
  const wanted = new Set(sites)
  const byTitle = new Map()
  for (const r of records) {
    if (!wanted.has(r.site)) continue
    const id = Number(r.title_id)
    if (!byTitle.has(id)) byTitle.set(id, [])
    byTitle.get(id).push(r)
  }

  const titles = {}
  for (const id of [...byTitle.keys()].sort((a, b) => a - b)) {
    if (handTitles[String(id)]) continue
    const picks = picksOfRecords(byTitle.get(id), skip)
    if (picks.length) titles[String(id)] = picks
  }

  const hasBooks = (id) => (byTitle.get(id) || []).some((r) => BOOK_TYPES.has(r.product_type))
  const noEnglishBooks = [...new Set(checkedIds.map(Number))].filter((id) => !hasBooks(id)).sort((a, b) => a - b)

  return { titles, noEnglishBooks }
}
