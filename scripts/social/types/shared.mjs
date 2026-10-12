/**
 * Small things every post type uses: which titles can be drawn, how they are
 * ordered, and the sizes a title is set in.
 */
import { isSmallCover } from '../image.mjs'
import { isDrawable, listOf } from '../text.mjs'

/** A title the image fonts can write, with a cover big enough to be the hero. */
export const usable = (title) => isDrawable(title.title) && !isSmallCover(title.image)

export const byPopularity = (x, y) => y.popularity - x.popularity

/** Title sizes for a full-width line in the display face, short titles first. */
export const TITLE_STEPS = [[18, 68], [36, 56], [60, 46], [90, 38]]
/** The longest title an image carries before it is cut with an ellipsis. */
export const TITLE_MAX = 90

export const top = (list, n = 3) => (list || []).slice(0, n)

/** "It streams on A, B and C." or null when nothing is known. */
export const streamsLine = (platforms, lead = 'It streams on') => (platforms?.length ? `${lead} ${listOf(top(platforms))}.` : null)

/** Keep the first of each key, in order. */
export function uniqueBy(list, keyOf) {
  const seen = new Set()
  return list.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
