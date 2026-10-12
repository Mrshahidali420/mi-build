/**
 * The Amazon product of one title, for the second line of the first comment
 * (site.mjs commentFor). It is the site's own shop logic and data, so a link
 * here is the link the title page shows:
 *
 *   src/lib/picks-core.js   which products belong to a title (hand picks
 *                           first, then the ones matched from publisher
 *                           records; a sequel or an adaptation borrows the
 *                           picks of its own story)
 *   src/lib/shop-links.js   the store and the site's own Associates tag
 *   src/lib/picks.js        the address of a product page (pickUrl)
 *   data/picks.json, data/product-picks.json, data/pick-isbn-formats.json
 *
 * Only a real product page (/dp/<ASIN>) is ever linked: a title with no pick
 * gets no Amazon line at all, never a search. The tag is always this site's
 * own; without one there is no link.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { picksForTitleIn, US_HOST } from '../../src/lib/picks-core.js'
import { storeFor } from '../../src/lib/shop-links.js'

const LABELS = { book: 'Get the book on Amazon', disc: 'Get the Blu-ray or DVD on Amazon', figure: 'Get the figure on Amazon' }
const OTHER_LABEL = 'Get it on Amazon'

/** The product page of one pick, exactly as src/lib/picks.js pickUrl() builds it. */
const pickUrlFor = (asin, tag) => `https://${US_HOST}/dp/${asin}?tag=${tag}`

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)

/** One pick as the comment needs it, or null without a pick or a tag. */
export function shopOf(pick, tag) {
  if (!pick?.a || !tag) return null
  return { name: pick.n || null, type: pick.t || null, label: LABELS[pick.t] || OTHER_LABEL, url: pickUrlFor(pick.a, tag) }
}

/**
 * item -> its shop pick or null, from the picks handed in. The first pick is
 * the one the title page leads its shelf with.
 */
export function shopFinderOf({ hand, products, formats, tag }) {
  if (!hand && !products) return () => null
  return (item) => shopOf(picksForTitleIn(hand, item, products, formats)?.picks?.[0], tag)
}

/** The finder bound to the site's own data folder and tag. */
export function shopFinder({ dir = join(process.cwd(), 'data') } = {}) {
  return shopFinderOf({ hand: readJson(join(dir, 'picks.json')), products: readJson(join(dir, 'product-picks.json')), formats: readJson(join(dir, 'pick-isbn-formats.json')), tag: storeFor('US').tag })
}
