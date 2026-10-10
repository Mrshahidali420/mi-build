/**
 * Build-time fields on each "like X" pick (item.similar), so the /like page
 * can say why THIS pick fits THIS title, from facts both records hold:
 *
 *   tags     up to 2 tags both carry (never a blocked one, see prose-words)
 *   author   a creator both share (credits for the English edition skipped)
 *   studio   an animation studio both share
 *   count    the pick's chapter or episode count
 *   year     the pick's start year
 *   inRecs   AniList readers also suggest it after this title
 *
 * Plus the ranking: a pick AniList readers suggest goes first, then the most
 * genres shared, then the most read. Deterministic, and nothing extra is
 * fetched. Called by scripts/make-shards.mjs. Pure.
 */
import { isBlocked } from './prose-words.mjs'

const TAGS_MAX = 2
// "Touch-up Art & Lettering (English)" and the like are not who made it.
const NOT_A_MAKER = /english|translat|letter|touch-up|editor/i

const makers = (item) =>
  new Set((item.authors || []).filter((a) => a && a.name && !NOT_A_MAKER.test(a.role || '')).map((a) => a.name))

/** The ids AniList readers suggest after this title. */
export const recSetOf = (item) => new Set((item.recIds || []).map((r) => r && r.id).filter(Boolean))

/** Readers' suggestions first, then shared genres, then popularity. */
export const byLikeRank = (recSet) => ([a, sa], [b, sb]) =>
  (recSet.has(b.id) ? 1 : 0) - (recSet.has(a.id) ? 1 : 0) || sb.length - sa.length || (b.popularity || 0) - (a.popularity || 0)

export function likeExtras(item, p, recSet = new Set()) {
  const own = new Set(item.tags || [])
  const tags = (p.tags || []).filter((t) => own.has(t) && !isBlocked(t)).slice(0, TAGS_MAX)
  const mine = makers(item)
  const author = [...makers(p)].find((name) => mine.has(name))
  const studios = new Set(item.studios || [])
  const studio = (p.studios || []).find((s) => studios.has(s))
  const count = p.kind === 'anime' ? p.episodes : p.chapters
  return {
    ...(tags.length ? { tags } : {}),
    ...(author ? { author } : {}),
    ...(studio ? { studio } : {}),
    ...(count ? { count } : {}),
    ...(p.startYear ? { year: p.startYear } : {}),
    ...(recSet.has(p.id) ? { inRecs: true } : {}),
  }
}
