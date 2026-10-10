/**
 * Facts for a title page with no official English platform (most of the
 * catalog): the official pages AniList lists for it, the licensed title we
 * list that is closest to it, and one short line per "read something like
 * it" pick saying why that pick fits. Used by prose.mjs at build time.
 *
 * Every line is built from fields the record holds: the pick's shared genres
 * and tags and same-author flag (worked out in src/lib/alike.mjs), its status
 * and chapter count, and the English platform it is on.
 */

import { officialPages } from './alike.mjs'
import { joinWords, fact, isBlocked, big } from './prose-words.mjs'

/** The official pages AniList lists: "Its official Japanese page is at comic-days.com." */
export function pagesFact(item) {
  const pages = officialPages(item, 2)
  if (!pages.length) return null
  const say = (p) =>
    p.language && p.language !== 'English'
      ? `an official ${p.language} page at ${p.host}`
      : p.site && p.site !== 'Official Site' && p.site !== p.host
        ? `a ${p.site} page at ${p.host}`
        : `an official site at ${p.host}`
  return fact('pages', 72, `AniList lists ${joinWords(pages.map(say))} for it.`)
}

const lowerSafe = (list) => (list || []).filter((g) => !isBlocked(g)).map((g) => g.toLowerCase())
const siteOf = (pick) => (pick.readLinks || [])[0]?.site || null

/** The reasons one pick fits, as short fragments, strongest first. */
function reasons(item, pick) {
  const out = []
  if (pick.sameAuthor) out.push('same author')
  const genres = lowerSafe(pick.shared)
  if (genres.length) out.push(`both are ${joinWords(genres)}`)
  const tags = lowerSafe(pick.tags)
  if (tags.length) out.push(`both are tagged ${joinWords(tags)}`)
  if (pick.status === 'FINISHED' && item.status !== 'FINISHED') {
    out.push(pick.chapters ? `complete at ${big(pick.chapters)} chapters` : 'complete')
  } else if (pick.status === 'FINISHED' && pick.chapters) {
    out.push(`also complete, at ${big(pick.chapters)} chapters`)
  } else if (pick.status === 'RELEASING' && item.status === 'RELEASING') {
    out.push('also still coming out')
  }
  return out
}

const sentenceOf = (fragments) => {
  const text = fragments.join('; ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

/** One line per "read something like it" pick, in the record's own order. */
export function alikeWhy(item) {
  return (item.alike || []).map((pick) => {
    const why = reasons(item, pick)
    const site = siteOf(pick)
    return [why.length ? sentenceOf(why) : '', site ? `In English on ${site}.` : ''].filter(Boolean).join(' ')
  })
}

/** The closest licensed pick, for the opening paragraph. */
export function alikeFact(item) {
  // Closest by what the two share: an author first, then tags and genres.
  const score = (p) => (p.sameAuthor ? 10 : 0) + (p.tags || []).length * 2 + (p.shared || []).length
  const pick = (item.alike || [])
    .filter((p) => p && p.title && siteOf(p))
    .reduce((best, p) => (!best || score(p) > score(best) ? p : best), null)
  if (!pick) return null
  const why = reasons(item, pick).slice(0, 2)
  const tail = why.length ? `: ${why.join('; ')}` : ''
  return fact('alike', 56, `The closest licensed read we list is ${pick.title}, in English on ${siteOf(pick)}${tail}.`)
}
