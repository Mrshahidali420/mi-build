/**
 * Hand-picked Amazon products.
 *
 * The shop links in shop-links.js open a live Amazon search, which works for
 * every title but lands the reader on a page of mixed results. For the series
 * and characters people visit most, real products were picked by hand instead
 * (volume 1, a box set, a figure, a plush). data/picks.json holds them, keyed
 * by AniList id; scripts/build-picks.mjs explains where they come from.
 *
 * Each pick is only an ASIN, a short name and a type. No price, no image and
 * no rating: those are Amazon's product data, which the Associates agreement
 * only allows through its API. The card shows our own cover instead.
 *
 * The products were picked on amazon.com, and a merch ASIN there often does
 * not exist on another country's Amazon. So picks are shown only to readers
 * whose store is the US one. Everyone else still gets the search rows in the
 * buy box, which work in their own store.
 *
 * Titles nobody picked by hand fall back to data/product-picks.json: volume 1,
 * a box set and a disc matched from publisher records by
 * scripts/picks-from-products.mjs. A hand pick always wins. The rules live in
 * picks-core.js, pure, so the tests can use them without these files.
 */
import data from '../../data/picks.json'
import products from '../../data/product-picks.json'
import formats from '../../data/pick-isbn-formats.json'
import { storeFor } from './shop-links.js'
import { US_HOST, PICK_LABELS, picksForTitleIn, booksKnownIn, pickType } from './picks-core.js'

export { PICK_LABELS }

export const pickUrl = (asin) => `https://${US_HOST}/dp/${asin}?tag=${storeFor('US').tag}`

// True when this reader shops on amazon.com, the store the picks were made on.
export const picksShowFor = (country) => storeFor(country).host === US_HOST

/**
 * The picks for one title page, and which title they were picked for (see
 * picks-core.js). `byHand` is false when they were matched from publisher
 * records rather than chosen by a person.
 */
export const picksForTitle = (item) => picksForTitleIn(data, item, products, formats)

/**
 * What a book pick is ("Light novel", "Manga", ...), or null when it cannot be
 * told honestly. `owner` is the record the picks were filed under (picked.owner).
 */
export const pickTypeOf = (pick, owner, item) => pickType(pick, owner, formats, item)

/**
 * Whether the buy box should offer a "Shop books" search for this title. False
 * only for a title that was checked and has no English print (picks-core.js).
 * Pass it to shopLinks as `{ books }`.
 */
export const booksKnown = (item) => booksKnownIn(data, item, products)

export const picksForCharacter = (person) =>
  (person && data.characters[String(person.id)]) || null

/**
 * The picks for a character page: the character's own, or else the picks of
 * the story they are from. `from` is null for their own, and otherwise names
 * the story, so the heading never claims a volume 1 is a figure of them.
 */
export function picksForPerson(person, story) {
  const own = picksForCharacter(person)
  if (own) return { picks: own, from: null, byHand: true, owner: null }
  const series = picksForTitle(story)
  return series
    ? { picks: series.picks, from: series.from || story.title, byHand: series.byHand, owner: series.owner }
    : null
}

// Every title id with its own picks. The shop page lists these.
export const pickedTitleIds = () => Object.keys(data.titles).map(Number)
export const pickedCharacterIds = () => Object.keys(data.characters).map(Number)
