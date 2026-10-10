/**
 * The thinnest title sub-pages, taken out of Google (owner decision, 10 Oct
 * 2026, after the September 2026 spam update): the page stays live and linked
 * for readers, answers with <meta name="robots" content="noindex,follow">, and
 * leaves the sitemap. A page with any Google impression in the last 90 days
 * (data/index-keep.json) is never noindexed. Title pages are never noindexed.
 *
 * Worked out at build time by scripts/make-shards.mjs, which stores the result
 * on the record (item.noindex: ['buy', 'like', ...], person.noindexBuy), so
 * the Worker only reads a flag. Pure.
 */
import { sectionOf } from './section.mjs'
import { freeSplit, linksOf, uniqueBySite } from './answers.mjs'
import { hasFreePage, hasLikePage, hasCastPage, hasBuyPage, hasCharacterBuyPage } from './gates.mjs'

export const LIKE_MIN_WITH_PLATFORM = 2
export const FREE_MIN_PLATFORMS = 2
export const CAST_MIN_VOICED = 3
export const CAST_MIN_LEADS = 2

/** /buy: shop search rows only, a thin affiliate page. All of them. */
export const thinBuy = () => true

/** /like: fewer than two picks you can actually go and get. */
export function thinLike(item) {
  const sited = (item.similar || []).filter((p) => uniqueBySite(p.kind === 'anime' ? p.watchLinks : p.readLinks).length > 0)
  return sited.length < LIKE_MIN_WITH_PLATFORM
}

/** /free: one free platform says nothing the title page does not. */
export const thinFree = (item) => freeSplit(linksOf(item)).free.length < FREE_MIN_PLATFORMS

/** /characters: a bare face grid, few voices and few leads. */
export function thinCast(item) {
  const faces = (item.characters || []).filter((c) => c.image)
  const voiced = faces.filter((c) => c.voice || c.voiceEn).length
  const leads = faces.filter((c) => c.role === 'MAIN').length
  return voiced < CAST_MIN_VOICED && leads < CAST_MIN_LEADS
}

// [sub-page, its own gate, its thin rule]. A page that does not exist (gate
// fails) is never flagged: it answers 404 and is in no sitemap anyway.
const RULES = [
  ['free', hasFreePage, thinFree],
  ['like', hasLikePage, thinLike],
  ['characters', hasCastPage, thinCast],
  ['buy', hasBuyPage, thinBuy],
]

/**
 * The sub-pages of one title to noindex.
 * @param keep Set of paths from data/index-keep.json
 * @returns {string[]} e.g. ['buy', 'like']
 */
export function noindexSubpages(item, keep = new Set()) {
  const path = `/${sectionOf(item)}/${item.slug}`
  return RULES.filter(([page, exists, thin]) => exists(item) && thin(item) && !keep.has(`${path}/${page}`)).map(([page]) => page)
}

/** A character's /buy page: all of them, unless Google shows it. */
export const noindexCharacterBuy = (person, keep = new Set()) =>
  hasCharacterBuyPage(person) && !keep.has(`/character/${person.slug}/buy`)

/** What the page reads: is this sub-page flagged? */
export const isNoindexed = (item, page) => Array.isArray(item?.noindex) && item.noindex.includes(page)

/**
 * A character's /buy page as a link target: only while it is indexed. A
 * noindexed one stays live, but the wall points at the profile's shop box.
 */
export const characterBuyLinkable = (person, keep = new Set()) =>
  hasCharacterBuyPage(person) && !person?.noindexBuy && !noindexCharacterBuy(person, keep)

/**
 * A cast list with the faces whose pages are indexed ahead of the noindexed
 * ones (c.noindex, set by make-shards.mjs), within each role, so a short grid
 * spends its links on pages Google can keep. Nobody is dropped. Pure.
 */
export function indexedFirst(cast = []) {
  const roles = [...new Set(cast.map((c) => c.role))]
  return roles.flatMap((role) => {
    const group = cast.filter((c) => c.role === role)
    return [...group.filter((c) => !c.noindex), ...group.filter((c) => c.noindex)]
  })
}
