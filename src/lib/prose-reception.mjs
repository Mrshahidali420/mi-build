/**
 * Title-page facts about how readers took it: AniList charts and scores,
 * MyAnimeList, reader counts, drops, favourites, recommendations and tags.
 * Used by prose.mjs.
 */

import {
  joinWords,
  big,
  same,
  fact,
  safeTags,
  safeGenres,
} from './prose-words.mjs'


export const CHART_WORDS = { POPULAR: 'most popular', RATED: 'highest rated' }

export function chartFact(item) {
  const chart = (item.ranks || [])
    .filter((r) => r.allTime && CHART_WORDS[r.type] && r.rank <= 500)
    .sort((a, b) => a.rank - b.rank)[0]
  if (!chart) return null
  return fact('chart', chart.rank <= 100 ? 66 : 46, `@ is #${chart.rank} on AniList's all-time ${CHART_WORDS[chart.type]} chart.`)
}

export function scoreFact(item, rank) {
  if (!item.score) return null
  if (rank && rank.top && rank.top <= 25) {
    return fact('rank', rank.top <= 5 ? 48 : 32, `Its AniList score of ${item.score} puts it in the top ${rank.top}% of the ${rank.label} we list.`)
  }
  return fact('score', 20, `AniList members score it ${item.score} out of 100.`)
}

export function malFact(item) {
  const mal = item.extra?.mal
  if (!mal || !mal.score) return null
  return fact('mal', 38, `On MyAnimeList it scores ${mal.score}${mal.scoredBy ? ` from ${big(mal.scoredBy)} votes` : ''}.`)
}

export function readersFact(item, kind) {
  const r = item.readers || {}
  const done = Number(r.completed) || 0
  const now = Number(r.current) || 0
  const planning = Number(r.planning) || 0
  const dropped = Number(r.dropped) || 0
  if (done < 50 && now < 50 && planning < 50) return null
  const doing = kind === 'anime' ? 'watching' : 'reading'
  const toDo = kind === 'anime' ? 'watch' : 'read'
  const weight = done + now >= 100000 ? 40 : 28
  // Which count is biggest decides what is worth saying.
  const top = Math.max(done, now, planning, dropped)
  if (item.status === 'RELEASING' && now === top) {
    const plan = planning >= 50 ? `, and ${big(planning)} more plan to start` : ''
    return fact('readers', weight, `${big(now)} AniList members are ${doing} it as it comes out${plan}.`)
  }
  if (dropped === top && done >= 50) return fact('readers', weight + 6, `More AniList members dropped it (${big(dropped)}) than finished it (${big(done)}).`)
  if (planning === top && planning > done) {
    return fact(
      'readers',
      weight + 2,
      done >= 50
        ? `It sits on ${big(planning)} AniList plan-to-${toDo} lists, more than the ${big(done)} members who have finished it.`
        : `It sits on ${big(planning)} AniList plan-to-${toDo} lists.`,
    )
  }
  if (now === top && done >= 50) return fact('readers', weight + 4, `More AniList members are ${doing} it now (${big(now)}) than have finished it (${big(done)}).`)
  if (done >= 50) {
    const partway = now >= 50 ? `, and ${big(now)} are partway through` : ''
    return fact('readers', weight, `${big(done)} AniList members have finished it${partway}.`)
  }
  return null
}

/** How many who start it give up, when that number says something. */
export function dropFact(item) {
  const r = item.readers || {}
  const dropped = Number(r.dropped) || 0
  const total = (Number(r.completed) || 0) + (Number(r.current) || 0) + (Number(r.paused) || 0) + dropped
  if (total < 1000) return null
  const pct = Math.round((dropped / total) * 100)
  if (pct >= 20) return fact('drop', 30, `${pct}% of the members who started it dropped it.`)
  if (pct <= 3) return fact('drop', 26, `Only ${pct}% of those who start it give up on it.`)
  return null
}

export function favouritesFact(item) {
  const fav = Number(item.favourites) || 0
  const done = Number(item.readers?.completed) || 0
  if (fav >= 1000) return fact('favourites', 24, `${big(fav)} members count it among their favourites.`)
  // Few people, but a large share of them loved it: worth saying.
  if (fav >= 20 && done >= 100 && fav * 10 >= done) {
    return fact('favourites', 26, `About one in ${Math.max(2, Math.round(done / fav))} members who finished it marked it a favourite.`)
  }
  return null
}

export function recFact(item) {
  const rec = (item.recs || []).find((p) => p && p.title && !same(p.title, item.title))
  if (!rec) return null
  const other = (rec.kind === 'anime') !== (item.kind === 'anime')
  const medium = other ? (rec.kind === 'anime' ? 'the anime ' : 'the book ') : ''
  return fact('rec', 30, `Readers on AniList most often suggest ${medium}${rec.title} after it.`)
}

/** Genres past the two the identity sentence names, and the tags readers add most. */
export function shapeFact(item) {
  const genres = safeGenres(item, 5).slice(3).map((g) => g.toLowerCase())
  const tags = safeTags(item, 5).map((t) => t.toLowerCase())
  if (!genres.length && !tags.length) return null
  if (!tags.length) return fact('shape', 14, `It is also filed under ${joinWords(genres)}.`)
  if (!genres.length) return fact('shape', 16, `Readers tag it ${joinWords(tags)}.`)
  return fact('shape', 16, `It is also filed under ${joinWords(genres)}, and readers tag it ${joinWords(tags)}.`)
}

