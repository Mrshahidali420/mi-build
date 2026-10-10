/**
 * The opening paragraph of Read / Watch on a title page.
 *
 * It is the "at a glance" text src/lib/prose.mjs wrote at build time from the
 * record's own facts. A record from an older build has no glance yet; it gets
 * the plain platform sentence instead, without the old closing lines that were
 * the same on every page.
 *
 * Pure string work over one record, the same cost as before.
 */

import { statusWord } from './format.js'

const listWords = (names) =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * @param item  the title record
 * @param word  'manhwa' | 'manga' | 'manhua' | 'novel' | 'anime'
 * @returns string
 */
export function titleAnswer(item, word) {
  const glance = item.overview?.glance
  if (glance) return glance

  const isComic = item.kind !== 'anime'
  const links = (isComic ? item.readLinks : item.watchLinks) || []
  const platformNames = [...new Set(links.map((l) => l.site))]
  const verb = isComic ? 'read' : 'watch'
  const status = statusWord(item.status).toLowerCase()
  const authorPart = item.authors?.length ? ` by ${item.authors.map((a) => a.name).join(', ')}` : ''
  const count = isComic ? item.chapters : item.episodes
  const countPart = count ? ` It has ${count} ${isComic ? 'chapters' : 'episodes'}.` : ''
  return platformNames.length
    ? `You can legally ${verb} ${item.title}, a ${status} ${word}${authorPart}, on ${listWords(platformNames)}.${countPart}`
    : `${item.title} is a ${status} ${word}${authorPart} with no official English ${isComic ? 'publisher' : 'streaming platform'} yet.${countPart}`
}

/** The "in short" paragraphs: the new `more`, or an older build's `paragraphs`. */
export const aboutParagraphs = (overview) => (overview && (overview.more || overview.paragraphs)) || []

/** The meta lede for JSON-LD: the glance, or an older build's lede. */
export const ledeOf = (overview) => (overview && (overview.glance || overview.lede)) || ''
