/**
 * "Manhwa like X" (/<kind>/<slug>/like). Says WHY each pick belongs and
 * WHERE you can legally get it, from fields both records hold: the shared
 * genres, and the build-time pick fields of src/lib/like-facts.mjs (shared
 * tags, author, studio, length, year, AniList readers' suggestions).
 *
 * The two paragraphs every like page used to share ("How these were picked",
 * "What the platform names mean") are gone: the lede says what this list is
 * made of, and each pick says how it differs from the title.
 */
import { wordOf, verbOf, unitOf, listWords, uniqueBySite } from './answers.mjs'

const big = (n) => Number(n).toLocaleString('en-GB')
const lower = (list) => (list || []).map((g) => g.toLowerCase())
const capital = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)

/** Why this pick fits: what it shares first, then how it differs. */
function reasonOf(item, pick, unit) {
  const shared = pick.author
    ? `also by ${pick.author}`
    : pick.studio
      ? `also animated by ${pick.studio}`
      : pick.tags?.length
        ? `both tagged ${listWords(lower(pick.tags))}`
        : pick.shared?.length
          ? `shares ${listWords(lower(pick.shared))}`
          : ''
  const suggested = pick.inRecs ? 'AniList readers suggest it next' : ''
  const own = item.kind === 'anime' ? item.episodes : item.chapters
  let length = ''
  if (pick.count && own) {
    length =
      pick.count >= own * 1.5
        ? `longer, at ${big(pick.count)} ${unit} to ${big(own)}`
        : pick.count * 1.5 <= own
          ? `shorter, at ${big(pick.count)} ${unit} to ${big(own)}`
          : `a similar length, ${big(pick.count)} ${unit}`
  } else if (pick.count && pick.status === 'FINISHED') {
    length = `complete at ${big(pick.count)} ${unit}`
  }
  const state = pick.status === 'RELEASING' ? 'still coming out' : pick.status === 'FINISHED' && item.status === 'RELEASING' && !length ? 'already finished' : ''
  const gap = pick.year && item.startYear ? pick.year - item.startYear : null
  const era =
    gap === null
      ? pick.year ? `from ${pick.year}` : ''
      : gap <= -5
        ? `${-gap} years older, from ${pick.year}`
        : gap >= 5
          ? `${gap} years newer, from ${pick.year}`
          : `from ${pick.year}`
  return capital([shared, suggested, length, state, era].filter(Boolean).slice(0, 4).join('; '))
}

export function likeAnswer(item, kind) {
  const word = wordOf(kind)
  const verb = verbOf(kind)
  const unit = unitOf(kind)
  const picks = (item.similar || [])
    .map((p, rank) => ({ ...p, rank, sites: uniqueBySite(p.kind === 'anime' ? p.watchLinks : p.readLinks).map((l) => l.site) }))
    // Readers' suggestions first, then a pick you can actually go and get,
    // then the build's own order.
    .sort((a, b) => (b.inRecs ? 1 : 0) - (a.inRecs ? 1 : 0) || (b.sites.length > 0) - (a.sites.length > 0) || a.rank - b.rank)
    .map(({ rank, ...p }) => ({ ...p, reason: reasonOf(item, p, unit) }))

  const heading = `${capital(word)} like ${item.title}`
  const finished = picks.filter((p) => p.status === 'FINISHED')
  const running = picks.filter((p) => p.status === 'RELEASING').length
  const longest = finished.filter((p) => p.count).sort((a, b) => b.count - a.count)[0]
  const withLinks = picks.filter((p) => p.sites.length > 0).length
  const suggested = picks.filter((p) => p.inRecs).length
  const authors = [...new Set(picks.map((p) => p.author).filter(Boolean))]
  const lede = picks.length
    ? [
        `${picks.length} ${word} share at least two genres with ${item.title}.`,
        suggested ? `AniList readers suggest ${suggested === picks.length ? 'every one of them' : `${suggested} of them`} after it too.` : '',
        authors.length ? `${authors.length === 1 ? 'One shares' : `${authors.length} share`} its ${authors.length === 1 ? 'creator' : 'creators'}, ${listWords(authors)}.` : '',
        finished.length
          ? `${finished.length === picks.length ? 'All' : finished.length} ${finished.length === 1 && picks.length > 1 ? 'has' : 'have'} finished${longest ? `, the longest at ${big(longest.count)} ${unit}` : ''}${running ? `; ${running} ${running === 1 ? 'is' : 'are'} still coming out` : ''}.`
          : running ? `${running} ${running === 1 ? 'is' : 'are'} still coming out.` : '',
        // Said only when some lack one: each pick names its own platforms below.
        withLinks === picks.length
          ? ''
          : withLinks ? `${withLinks} ${withLinks === 1 ? `has an official place to ${verb} it` : `have an official place to ${verb} them`} that we list.` : `None has an official platform we list yet.`,
      ].filter(Boolean).join(' ')
    : `We have no close match for ${item.title} in the index yet.`

  return {
    heading,
    pageTitle: `${heading} — ${picks.length} similar titles you can ${verb} legally`,
    description:
      picks.length > 0
        ? `${picks.length} ${word} similar to ${item.title}, picked on shared genres, each with the official platforms that carry it.`
        : `Similar titles to ${item.title}.`,
    lede,
    paragraphs: [],
    picks,
  }
}
