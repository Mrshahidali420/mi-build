/**
 * Title-page facts about the story itself: its run, place in a series,
 * adaptations, makers, identity, names, dub, songs and cast. Used by prose.mjs.
 */

import { dubOf } from './dub.mjs'
import {
  COUNTRY_WORDS,
  SEASON_WORDS,
  SECTION_WORDS,
  SHOW_WORDS,
  SOURCE_WORDS,
  RELATIVE_WORDS,
  joinWords,
  unique,
  plural,
  big,
  quoted,
  article,
  capital,
  same,
  fact,
  safeGenres,
} from './prose-words.mjs'


export function runAnime(item, yearSaid) {
  const what = SHOW_WORDS[item.format]
  const ep = item.episodes
  const start = item.startYear
  const end = item.endYear
  const season = item.season && item.seasonYear ? `${SEASON_WORDS[item.season] || ''} ${item.seasonYear}`.trim() : null
  const when = yearSaid ? null : season || start
  if (item.status === 'FINISHED' && item.format === 'MOVIE') {
    // With no year to add, identityFact already says it is a film.
    return when ? fact('run', 40, `It is an anime film, released in ${when}.`) : null
  }
  if (item.status === 'FINISHED' && ep) {
    if (ep >= 100) {
      const span = start && end && end > start && !yearSaid ? ` between ${start} and ${end}` : ''
      return fact('run', 62, `It is a long run: ${big(ep)} episodes${span}.`)
    }
    if (ep === 1) return when ? fact('run', 34, `Its one episode came out in ${when}.`) : null
    const as = what && what !== 'TV anime' ? ` as ${article(what)} ${what}` : ''
    return fact('run', 42, `All ${ep} episodes aired${when ? ` from ${when}` : ''}${as}.`)
  }
  if (item.status === 'RELEASING') return fact('run', 55, `It is airing now${ep ? `, ${ep} episodes planned` : ''}${when ? `, since ${when}` : ''}.`)
  if (item.status === 'NOT_YET_RELEASED') return fact('run', 58, season ? `It is due to start in ${season}.` : 'It has been announced, with no start date yet.')
  if (item.status === 'CANCELLED') return fact('run', 65, 'It was cancelled before it finished.')
  if (item.status === 'HIATUS') return fact('run', 65, 'It is on a break, with no restart date.')
  return null
}

export function runFinished(unit, vol, start, end, yearSaid) {
  const span = start && end && end > start ? end - start : 0
  const volPart = vol ? (vol === 1 ? ' in one volume' : ` across ${vol} volumes`) : ''
  if (unit) {
    if (unit === 1) return fact('run', 40, 'It is a single, complete chapter.')
    if (unit <= 12) return fact('run', 40, `It is a quick read: ${unit} chapters${volPart}, all out.`)
    if (unit < 100) {
      return span && !yearSaid
        ? fact('run', 44, `It finished in ${end} after ${unit} chapters${volPart}, ${span} ${plural(span, 'year', 'years')} after it began.`)
        : fact('run', 42, `It is complete at ${unit} chapters${volPart}.`)
    }
    if (unit < 300) {
      const took = span && !yearSaid ? ` took ${span} ${plural(span, 'year', 'years')} to finish` : ' are all out'
      return fact('run', 50, `Its ${big(unit)} chapters${took}${vol ? `, filling ${vol} volumes` : ''}.`)
    }
    return fact('run', 60, `At ${big(unit)} chapters${vol ? ` and ${vol} volumes` : ''}, it is a long read, and all of it is out.`)
  }
  if (vol) return fact('run', 40, vol === 1 ? 'The whole story fits in one volume.' : `It is finished, collected in ${vol} volumes.`)
  if (yearSaid) return null
  if (span) return fact('run', 34, `It ran from ${start} to ${end} and is finished.`)
  if (start) return fact('run', 30, `It came out in ${start} and is finished.`)
  return fact('run', 26, 'The story is finished.')
}

/** Status against size: "finished at 180 chapters", "on hiatus after 40". */
export function runFact(item, kind, yearSaid) {
  if (kind === 'anime') return runAnime(item, yearSaid)
  const ch = item.chapters
  const vol = item.volumes
  const start = item.startYear
  // identityFact says the size of a one-shot or a short finished story.
  if (smallSize(item, kind)) return null
  if (item.status === 'FINISHED') return runFinished(ch, vol, start, item.endYear, yearSaid)
  if (item.status === 'RELEASING') {
    if (ch >= 300) return fact('run', 58, `It is still going after ${big(ch)} chapters.`)
    if (ch) return fact('run', 46, `It is still running, with ${big(ch)} chapters counted so far.`)
    if (yearSaid) return null
    return fact('run', 38, start ? `New chapters have been coming out since ${start}.` : 'New chapters are still coming out.')
  }
  if (item.status === 'HIATUS') return fact('run', 66, `It is on hiatus${ch ? ` after ${big(ch)} chapters` : ''}, with no restart date.`)
  if (item.status === 'CANCELLED') {
    return fact('run', 66, `It was cancelled${ch ? ` at chapter ${big(ch)}` : ''}${item.endYear ? ` in ${item.endYear}` : ''}, before the story ended.`)
  }
  if (item.status === 'NOT_YET_RELEASED') return fact('run', 55, 'It has been announced but has not started yet.')
  return null
}

/** Where this part sits in a series of prequels and sequels. */
export function chainFact(item, kind) {
  const chain = item.chain || []
  if (chain.length < 2) return null
  const at = chain.findIndex((part) => part.self)
  if (at < 0) return null
  const verb = kind === 'anime' ? 'watch' : 'read'
  if (at === 0) return fact('chain', 75, `@ opens a ${chain.length}-part series; ${chain[1].title} comes next.`)
  if (at === chain.length - 1) return fact('chain', 75, `@ is the last of ${chain.length} parts, so ${verb} ${chain[0].title} first.`)
  return fact('chain', 75, `@ is part ${at + 1} of ${chain.length}: ${chain[at - 1].title} comes before it and ${chain[at + 1].title} after.`)
}

/** Side stories, spin-offs and alternative versions around it. */
export function relativesFact(item) {
  const rels = (item.relations || []).filter((rel) => RELATIVE_WORDS[rel.relation] && rel.title)
  if (!rels.length) return null
  const counts = new Map()
  for (const rel of rels) counts.set(rel.relation, (counts.get(rel.relation) || 0) + 1)
  const parts = [...counts].map(([rel, n]) => `${n === 1 ? article(RELATIVE_WORDS[rel][0]) : n} ${plural(n, ...RELATIVE_WORDS[rel])}`)
  const named = rels.length === 1 ? `, ${rels[0].title}` : `, among them ${rels[0].title}`
  return fact('relatives', 34, `It also has ${joinWords(parts)}${named}.`)
}

export function showWords(show) {
  const what = SHOW_WORDS[show.format] || 'anime'
  if (show.format === 'TV' && show.episodes) return `a ${show.episodes}-episode TV anime`
  return `${article(what)} ${what}`
}

/** The anime made from a comic, or the book behind an anime. */
export function adaptFact(item, kind, hasLinks) {
  const adapt = item.adapt
  if (kind === 'anime') {
    const src = adapt?.source
    if (!src) return null
    const word = SECTION_WORDS[src.kind] || 'comic'
    const name = same(src.title, item.title) ? `the ${word} of the same name` : `the ${word} ${src.title}`
    const state =
      src.status === 'FINISHED' && src.chapters
        ? `, which finished at ${big(src.chapters)} chapters`
        : src.status === 'RELEASING'
          ? ', which is still running'
          : ''
    const where = src.sites?.length ? `. The ${word} is out in English on ${joinWords(src.sites)}` : ''
    return fact('adapt', 70, `@ adapts ${name}${state}${where}.`)
  }

  const shows = adapt?.shows || []
  if (shows.length) {
    const streamed = shows.find((s) => s.sites?.length)
    const coming = shows.find((s) => s.status === 'NOT_YET_RELEASED')
    if (streamed) {
      const name = same(streamed.title, item.title) ? 'The anime of the same name' : `Its anime, ${streamed.title},`
      const others = shows.length > 1 ? `, one of ${shows.length} screen versions` : ''
      return fact('adapt', hasLinks ? 74 : 86, `${name} streams on ${joinWords(streamed.sites)}${others}.`)
    }
    if (coming && shows.length > 1) {
      const made = shows.length - 1
      return fact('adapt', 80, `It has ${made} screen ${plural(made, 'version', 'versions')} so far, and ${showWords(coming)} has been announced.`)
    }
    if (coming) return fact('adapt', 80, `${capital(showWords(coming))} based on it has been announced.`)
    const first = shows[0]
    if (shows.length === 1) return fact('adapt', 66, `It was made into ${showWords(first)}${first.startYear ? ` in ${first.startYear}` : ''}.`)
    return fact('adapt', 68, `It has ${shows.length} screen versions${first.startYear ? `, the first in ${first.startYear}` : ''}.`)
  }
  if (item.animeInIndex?.length) return fact('adapt', 60, 'There is an anime version of @, with its own page here.')
  return null
}

/** Another name it is listed under, so a reader who knows only that one is sure this is the page. */
export function aliasFact(item) {
  const alias = (item.synonyms || []).find(
    (n) => /^[ -~À-ɏ'’!?.,:&()-]+$/.test(n) && !same(n, item.title) && !same(n, item.titleRomaji),
  )
  return alias ? fact('alias', 20, `It is also listed as ${alias.replace(/[.\s]+$/, '')}.`) : null
}

/** Who made it: the author roles for a book, the director and composer for an anime. */
export function makersFact(item, kind) {
  if (kind === 'anime') {
    const staff = item.staff || []
    const director = staff.find((s) => s.role === 'Director')?.name
    const music = staff.find((s) => s.role === 'Music')?.name
    // The studio is named in identityFact.
    if (director && music) return fact('makers', 50, `${director} directed it, and ${music} wrote the music.`)
    if (director) return fact('makers', 44, `${director} directed it.`)
    if (music) return fact('makers', 40, `The music is by ${music}.`)
    return null
  }
  const authors = (item.authors || []).filter((a) => a && a.name)
  const roleOf = (a) => String(a.role || '').trim().toLowerCase()
  const names = (list) => joinWords(list.slice(0, 2).map((a) => a.name))
  const both = authors.filter((a) => /^story & (art|illustration)/.test(roleOf(a)))
  const story = authors.filter((a) => roleOf(a) === 'story' || roleOf(a) === 'original story')
  const art = authors.filter((a) => roleOf(a) === 'art' || roleOf(a) === 'illustration')
  if (both.length === 1 && !story.length && !art.length) return fact('makers', 34, `${both[0].name} both writes and draws it.`)
  if (story.length && art.length) return fact('makers', 38, `${names(story)} wrote it and ${names(art)} drew it.`)
  if (kind === 'novel' && story.length) return fact('makers', 34, `${names(story)} wrote it.`)
  return null
}

/**
 * A short comic's size as a word in front of it ("a 5-chapter", "a
 * one-volume"), said inside the identity sentence instead of on its own.
 * runFact stays quiet for these.
 */
export function smallSize(item, kind) {
  if (kind === 'anime') return null
  if (item.format === 'ONE_SHOT') return 'single-chapter'
  if (item.status !== 'FINISHED') return null
  const ch = item.chapters
  const vol = item.volumes
  if (ch === 1) return 'single-chapter'
  if (ch && ch <= 12) return `${ch}-chapter${vol === 1 ? ', one-volume' : ''}`
  if (!ch && vol) return vol === 1 ? 'one-volume' : `${vol}-volume`
  return null
}

/**
 * What it is: size, origin, genre, format, source and makers in one
 * sentence, so a record with little else to say still gets a sentence that
 * is its own. `phrase` lets the "no official edition" sentence carry it as
 * an aside: "X, a 5-chapter Japanese romance manga by Y, ended in 2010...".
 */
export function identityFact(item, kind, yearSaid, makersSaid) {
  const origin = COUNTRY_WORDS[item.country] || ''
  const oneShot = kind !== 'anime' && item.format === 'ONE_SHOT'
  const word = kind === 'anime' ? SHOW_WORDS[item.format] || 'anime' : oneShot ? `one-shot ${SECTION_WORDS[kind] || 'comic'}` : SECTION_WORDS[kind] || 'comic'
  const genre = joinWords(safeGenres(item, 3).map((g) => g.toLowerCase()))
  const original = kind === 'anime' && item.source === 'ORIGINAL' && !item.adapt?.source
  const size = oneShot ? null : smallSize(item, kind)
  const lead = [size, original ? 'original' : '', origin, genre, word].filter(Boolean).join(' ')
  const from = kind === 'anime' ? (item.adapt?.source ? null : SOURCE_WORDS[item.source]) : kind === 'novel' ? null : SOURCE_WORDS[item.source]
  const basedOn = from && from !== 'a manga' ? `, based on ${from}` : ''
  // The makers sentence already names the authors; they are not named twice.
  const by = kind === 'anime' ? (item.studios || []).slice(0, 1) : makersSaid ? [] : unique((item.authors || []).map((a) => a && a.name)).slice(0, 2)
  const year = !yearSaid && item.startYear ? ` from ${item.startYear}` : ''
  const maker = by.length ? (kind === 'anime' ? ` made by ${by[0]}` : ` by ${joinWords(by)}`) : ''
  const phrase = `${article(lead)} ${lead}${maker}${year}${basedOn}`
  const weight = size || oneShot ? 40 : basedOn || original ? 34 : 22
  return { ...fact('identity', weight, `@ is ${phrase}.`), phrase }
}

/** The original-language title, when it differs from the one on the page. */
export function altTitleFact(item) {
  const romaji = item.titleRomaji
  if (!romaji || same(romaji, item.title) || !COUNTRY_WORDS[item.country]) return null
  const lang = COUNTRY_WORDS[item.country]
  return fact('altTitle', 24, item.country === 'JP' ? `Its Japanese title reads ${romaji}.` : `Its ${lang} title is romanised as ${romaji}.`)
}

export function dubFact(item) {
  const dub = dubOf(item)
  if (!dub) return null
  if (dub.state === 'sub') {
    const lead = (item.characters || []).find((c) => c && c.role === 'MAIN' && c.voice)
    return lead
      ? fact('dub', 50, `Only a Japanese cast is listed, with ${lead.voice} as ${lead.name}, so expect subtitles rather than an English dub.`)
      : fact('dub', 50, 'No English dub cast is listed, so expect Japanese audio with subtitles.')
  }
  const first = dub.english[0]
  const count = dub.english.length > 1 ? ` with ${dub.english.length} credited voices` : ''
  return fact('dub', 56, `There is an English dub${count}; ${first.voice} plays ${first.name}.`)
}

export function themesFact(item) {
  const themes = item.themes || []
  if (!themes.length) return null
  const first = themes.find((t) => t.type === 'OP') || themes[0]
  const by = (first.artists || []).length ? ` by ${joinWords(first.artists.slice(0, 2))}` : ''
  if (themes.length === 1) return fact('themes', 46, `Its one theme song is ${quoted(first.title)}${by}.`)
  const capped = ['OP', 'ED'].some((type) => themes.filter((t) => t.type === type).length >= 12)
  const role = first.type === 'OP' ? 'opening' : 'ending'
  return fact('themes', 50, `It has ${capped ? `more than ${themes.length}` : themes.length} theme songs; the first ${role} is ${quoted(first.title)}${by}.`)
}

export function castFact(item) {
  const cast = (item.characters || []).filter((c) => c && c.name)
  if (!cast.length) return null
  const leads = cast.filter((c) => c.role === 'MAIN').map((c) => c.name).slice(0, 2)
  if (!leads.length) return cast.length >= 5 ? fact('cast', 26, `Its cast list names ${cast.length} characters.`) : null
  if (cast.length <= leads.length) return fact('cast', 34, `The story follows ${joinWords(leads)}.`)
  return fact('cast', 40, `${joinWords(leads)} ${leads.length === 1 ? 'leads' : 'lead'} a cast of ${cast.length} named characters.`)
}

