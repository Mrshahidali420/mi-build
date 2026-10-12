/**
 * Small things every post type uses: which titles can be drawn, how they are
 * ordered, and the sizes a title is set in.
 */
import { isSmallCover } from '../image.mjs'
import { tagsFor } from '../story.mjs'
import { clip, isDrawable, listOf } from '../text.mjs'

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

/** The status in the words readers use. Nothing here claims a schedule the record does not hold. */
const STATUS = { FINISHED: 'Completed', HIATUS: 'On hiatus', NOT_YET_RELEASED: 'Not yet released', CANCELLED: 'Cancelled' }
export const statusWord = (t) => (t.status === 'RELEASING' ? (t.verb === 'watch' ? 'Currently airing' : 'Ongoing') : STATUS[t.status] || null)

/** The first genres that fit a line or two: at most `count`, and no more than GENRES_MAX characters in all. */
const GENRES_MAX = 30
const genresText = (list, count) => top(list, count).reduce((text, genre) => (text && `${text} · ${genre}`.length > GENRES_MAX ? text : text ? `${text} · ${genre}` : genre), '')

/** What an image says about a title (parts.mjs about()): score, genres as plain text, status, another name. */
export const aboutOf = (t, { genres = 3, status = true, alt = true } = {}) => ({
  rating: t.rating || null,
  genres: genresText(t.genres, genres) || null,
  status: status ? statusWord(t) : null,
  alt: alt && t.alt ? clip(t.alt, 44) : null,
})

/** What every post about one title carries: its synopsis, its hashtags and its shop pick (site.mjs commentFor). */
export const single = (t) => ({ title: t.title, path: t.path, synopsis: t.synopsis || null, tagline: t.tagline || null, shop: t.shop || null, platform: t.platforms?.[0] || null, tags: tagsFor(t) })

/** The image line of a list post whose comment links the title in first place. */
export const START_WITH_ONE = 'Start with #1: link in the first comment'

/** "Are you following X on WEBTOON?" when a platform is known; the plain question otherwise. */
export const onPlatform = (p, lead) => `${lead} ${p.title}${p.platform ? ` on ${p.platform}` : ''}?`

/** Caption facts, each null when the record lacks it. */
export const ratingLine = (t) => (t.rating ? `⭐ ${t.rating} out of 10 on AniList.` : null)
export const genresLine = (t) => (t.genres?.length ? `Genres: ${listOf(top(t.genres))}.` : null)
export const akaLine = (t) => {
  const names = [t.native, t.alt].filter(Boolean)
  return names.length ? `Also known as ${names.length === 2 ? `${names[0]} (${names[1]})` : names[0]}.` : null
}
/** Rating, genres and the other name, in that order. */
export const keyFacts = (t) => [ratingLine(t), genresLine(t), akaLine(t)]

/** The caption line that points at the first comment, three wordings per verb. */
const CTAS = {
  watch: ['👇 Every official place to watch it is linked in the first comment.', '👇 Where to watch it, with the links: see the first comment.', '👇 Link in the first comment: every legal stream for it.'],
  read: ['👇 Every legal place to read it is linked in the first comment.', '👇 Where to read it, free and paid: see the first comment.', '👇 Link in the first comment: every official platform for it.'],
  episode: ['👇 Episode dates and where to watch: link in the first comment.', '👇 The full episode schedule and every official stream are in the first comment.', '👇 Link in the first comment: when each episode airs and where to watch.'],
  // The comment of this post opens a page that lists them all.
  list: ['👇 The full list, with where to find each one: link in the first comment.', '👇 More like these in the first comment.', '👇 Link in the first comment: the whole list.'],
  // The comment of this post opens the title in first place, not a list.
  first: ['👇 Start with #1: the link is in the first comment.', '👇 Number one on this list is linked in the first comment.', '👇 Link in the first comment: where to find #1.'],
}
export const ctaOf = (kind, turn) => CTAS[kind][turn % CTAS[kind].length]

/** Font sizes of a list of site names by how many there are: few are large, many are compact. */
export const placeSizes = (count) => (count <= 2 ? { name: 50, pad: 18, sub: 22, about: 27 } : count <= 4 ? { name: 38, pad: 13, sub: 20, about: 25 } : { name: 30, pad: 9, sub: 18, about: 23 })

/** "3 legal places · 2 free to start": the same line the title page opens its list with. */
export const placesHead = (total, free) => [`${total} legal ${total === 1 ? 'place' : 'places'}`, free > 0 && `${free} free to start`].filter(Boolean).join(' · ')

/**
 * The rows of a list of official sites: every one when they fit, or the
 * first few and how many more the page holds.
 * @param places [{ site, language, free }] from source.mjs
 */
export function placeRows(places, max = 5) {
  const shown = places.length > max ? places.slice(0, max - 1) : places
  const rows = shown.map((p) => ({ name: clip(p.site, 24), sub: [p.language && !/english/i.test(p.language) && p.language, p.free && 'Free to start'].filter(Boolean).join(' · ') || null }))
  return { rows, more: places.length - shown.length }
}

/**
 * The column of official sites every "where" image carries: a counted
 * heading, one row per site, then (when there is room) how much of the story
 * is out, and what the record says about it. The three groups are spread
 * over the column's height, so one site and six sites both fill it.
 * @param v { head, sites, more, count, countLine, about }
 */
export function placesColumn(v, k, t, { width, height }) {
  const size = placeSizes(v.sites.length + (v.more ? 1 : 0))
  const roomy = v.sites.length <= 3 && !v.more
  return k.col(
    { width, height, justifyContent: 'space-between' },
    k.col(
      {},
      k.kicker(v.head, { color: t.soft, fontSize: 18, letterSpacing: 1.5, marginBottom: 14 }),
      v.sites.map((site) =>
        k.col(
          { borderTop: `2px solid ${t.line}`, paddingTop: size.pad, paddingBottom: size.pad },
          k.display({ ...k.clamp(1), fontSize: Math.round(size.name * (site.name.length > 18 ? 0.6 : site.name.length > 14 ? 0.76 : 1)), fontWeight: k.f.displayBlack, lineHeight: 1.1 }, site.name),
          site.sub && k.body({ fontSize: size.sub, color: t.pop, fontWeight: k.f.textBold, marginTop: 2 }, site.sub),
        ),
      ),
      v.more > 0 && k.box({ borderTop: `2px solid ${t.line}`, paddingTop: size.pad }, k.body({ fontSize: size.sub + 4, color: t.soft }, `and ${v.more} more on the site`)),
    ),
    roomy &&
      (v.count || v.countLine) &&
      k.col(
        {},
        v.count && k.display({ fontSize: v.count.length > 4 ? 84 : v.count.length > 3 ? 104 : 128, fontWeight: k.f.displayBlack, lineHeight: 0.9, marginLeft: -4 }, v.count),
        v.countLine && k.body({ fontSize: 28, color: t.soft, marginTop: 8 }, v.countLine),
      ),
    k.about(v.about, t, { size: size.about, width }),
  )
}
