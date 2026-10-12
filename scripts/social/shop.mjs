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
import { picksForTitleIn, pickType, US_HOST } from '../../src/lib/picks-core.js'
import { storeFor } from '../../src/lib/shop-links.js'

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)

/** The product page of one pick, exactly as src/lib/picks.js pickUrl() builds it. */
const pickUrlFor = (asin, tag) => `https://${US_HOST}/dp/${asin}?tag=${tag}`

/** Sources a show can honestly be said to be "based on" (an original anime's manga came after it). */
const PRINT_SOURCES = new Set(['MANGA', 'LIGHT_NOVEL', 'NOVEL', 'WEB_NOVEL', 'ONE_SHOT', 'DOUJINSHI', 'COMIC'])
const THINGS = { figure: 'figure', plush: 'plush', poster: 'poster', apparel: 'apparel', merch: 'merch' }

/**
 * What the Amazon line says, fitted to the product and to the post: a manga
 * volume under an anime post is "the manga it is based on", never "the book"
 * for a figure, never "based on" for an original anime.
 * @param word what a book pick is ("Manga", "Light novel", ...) or null when it cannot be told
 */
export function shopLabel(pick, item, word) {
  const name = String(pick?.n || '')
  if (pick.t === 'book') {
    const what = word ? word.toLowerCase() : null
    if (item?.kind === 'anime' && PRINT_SOURCES.has(item.source)) return `Read the ${what || 'book'} it is based on`
    return `Get the ${what || 'English edition'} on Amazon`
  }
  if (pick.t === 'disc') return /blu-?ray/i.test(name) ? 'Get the Blu-ray on Amazon' : /\bdvd\b/i.test(name) ? 'Get the DVD on Amazon' : 'Get the Blu-ray or DVD on Amazon'
  return `Get the ${THINGS[pick.t] || 'merch'} on Amazon`
}

/** One pick as the comment needs it, or null without a pick or a tag. */
export function shopOf(pick, tag, label = 'Get it on Amazon') {
  if (!pick?.a || !tag) return null
  return { name: pick.n || null, type: pick.t || null, label, url: pickUrlFor(pick.a, tag) }
}

/**
 * item -> its shop pick or null, from the picks handed in. The first pick is
 * the one the title page leads its shelf with. What a book is comes from the site's own pickType().
 */
export function shopFinderOf({ hand, products, formats, tag }) {
  if (!hand && !products) return () => null
  return (item) => {
    const picked = picksForTitleIn(hand, item, products, formats)
    const pick = picked?.picks?.[0]
    return pick ? shopOf(pick, tag, shopLabel(pick, item, pickType(pick, picked.owner, formats, item))) : null
  }
}

/** The finder bound to the site's own data folder and tag. */
export function shopFinder({ dir = join(process.cwd(), 'data') } = {}) {
  return shopFinderOf({ hand: readJson(join(dir, 'picks.json')), products: readJson(join(dir, 'product-picks.json')), formats: readJson(join(dir, 'pick-isbn-formats.json')), tag: storeFor('US').tag })
}
