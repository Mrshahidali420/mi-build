/**
 * What a post can say about a title beyond its name: the rating, another
 * name it goes by, a short synopsis, and hashtags built from its own record.
 *
 * Posts exist to send people to the site (tasks/lessons.md), so every image
 * and caption carries these when the record has them. A field the record
 * lacks is null and is left out; nothing is guessed.
 *
 * Pure: no files, no network.
 */
import { cleanText, isDrawable } from './text.mjs'

export const SYNOPSIS_MAX = 280
export const SYNOPSIS_MIN = 60
export const MAX_HASHTAGS = 7
const TAG_MAX = 30
const ALT_MAX = 48
const NATIVE_MAX = 40

const EMOJI = /\p{Extended_Pictographic}/gu
const HAS_EMOJI = /\p{Extended_Pictographic}/u
const plain = (value) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** AniList's 0-100 score the way the site shows it: "7.3". */
export const ratingOf = (score) => (score > 0 ? (score / 10).toFixed(1) : null)

/** Another name in Latin letters (the romanised title, or a synonym), for the image. */
export function altNameOf(item) {
  const own = plain(item.title)
  const names = [item.titleRomaji, ...(item.synonyms || [])].map((name) => String(name || '').replace(/\s+/g, ' ').trim())
  return names.find((name) => name.length >= 3 && name.length <= ALT_MAX && isDrawable(name) && cleanText(name) === name && plain(name) !== own) || null
}

/** The title in its own script, for the caption (Facebook can write it; the image fonts cannot). */
export function nativeOf(item) {
  const name = String(item.titleNative || '').replace(/\s+/g, ' ').trim()
  if (!name || name.length > NATIVE_MAX || plain(name) === plain(item.title) || HAS_EMOJI.test(name)) return null
  return name
}

/** The record's blurb as plain text: no HTML, no markdown, no spoiler text, no source credit, no notes. */
export function plainBlurb(description) {
  return String(description || '')
    .replace(/~!([\s\S]*?)!~/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n\s*(notes?|note):[\s\S]*$/i, ' ')
    .replace(/\(\s*source:[^)]*\)/gi, ' ')
    .replace(/\[\s*written by[^\]]*\]/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/(\*\*|__|~~|[*_`#])/g, '')
    .replace(EMOJI, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const SENTENCE_BREAK = /(?<=[.!?…]["'”’)]?)\s+(?=[A-Z0-9"'“‘(])/
const MIN_WORDS = 4
export const TAGLINE_MAX = 110

/** A sentence a synopsis may not end on: a teaser question, a lead-in colon, a trailing-off ellipsis, or a scrap of a few words. */
const isLoose = (sentence) => /[?:]["'”’)]?$/.test(sentence) || /(\.{2,}|…)["'”’)]?$/.test(sentence) || sentence.split(/\s+/).length < MIN_WORDS

/**
 * The first sentences of the blurb, as many as fit in `max` characters. It
 * never ends on a loose sentence ("The proof?", "And then..."): those are
 * dropped from the end. Null when there is no blurb, when even its first
 * sentence is too long, or when what is left is too short to say anything.
 */
export function synopsisOf(description, { max = SYNOPSIS_MAX, min = SYNOPSIS_MIN } = {}) {
  const kept = []
  for (const sentence of plainBlurb(description).split(SENTENCE_BREAK)) {
    if ([...kept, sentence].join(' ').length > max) break
    kept.push(sentence)
  }
  while (kept.length && isLoose(kept.at(-1))) kept.pop()
  const text = kept.join(' ')
  return text.length >= min && /[.!]["'”’)]?$/.test(text) ? text : null
}

/** A pause written as dots anywhere in a line reads as a cut-off on an image. */
const TRAILS_OFF = /\.{2,}|…/

/**
 * One line for the image, under the title: the blurb's first sentence, when
 * it is whole, short enough and something the image fonts can write.
 */
export function taglineOf(description, max = TAGLINE_MAX) {
  const [first] = plainBlurb(description).split(SENTENCE_BREAK)
  if (!first || first.length > max || isLoose(first) || TRAILS_OFF.test(first) || !/[.!]["'”’)]?$/.test(first)) return null
  return isDrawable(first) && cleanText(first).length >= first.length - 2 ? cleanText(first) : null
}

/** Words that name a season or a part, not the story: they are left out of the title's hashtag. */
const PART = /\s+(?:(?:\d+(?:st|nd|rd|th)|second|third|final)\s+(?:season|cour|part)|(?:season|part|cour)\s+\d+|(?:the\s+)?(?:final|second|third)\s+season|ii|iii|iv)\s*$/i

/** The story's own name: no season or part suffix, and no subtitle when two words or more stand before the colon. */
export function baseTitle(title) {
  let name = String(title || '').trim()
  for (let i = 0; i < 3 && PART.test(name); i += 1) name = name.replace(PART, '').trim()
  const [head] = name.split(/:\s|\s[-–—]\s/)
  return head.trim().split(/\s+/).length >= 2 ? head.trim() : name
}

/**
 * A hashtag from a name: letters and digits only, each word capitalised
 * ("One Piece" -> "#OnePiece", "PSYREN" -> "#PSYREN"). Null when nothing is
 * left, when it is only digits, or when it is too long to be a tag.
 */
export function tagOf(name, { lower = false } = {}) {
  const words = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’.]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
  const joined = words.map((word) => (lower ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1))).join('')
  if (!joined || joined.length > TAG_MAX || /^\d+$/.test(joined)) return null
  return `#${joined}`
}

const SEASON_WORD = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' }

/** "#FallAnime2026" from the record's own season, or null. */
export const seasonTag = (season) => (season && SEASON_WORD[season.name] && season.year ? `#${SEASON_WORD[season.name]}Anime${season.year}` : null)

/** Up to six different hashtags, in the order given. */
export function uniqueTags(tags, max = MAX_HASHTAGS) {
  const seen = new Set()
  return tags.filter((tag) => {
    const key = String(tag || '').toLowerCase()
    if (!tag || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, max)
}

/** The tags readers of each kind of title already follow. A short fixed list; nothing is made up per post. */
export const COMMUNITY_TAGS = {
  anime: ['#AnimeRecommendation'],
  manhwa: ['#ManhwaRecommendation', '#KoreanWebtoon'],
  manga: ['#MangaRecommendation'],
  manhua: ['#ManhuaRecommendation'],
  novel: ['#NovelRecommendation'],
}

/** AniList tags that name a sub-genre people search for. Only one that is on the record is ever used. */
export const SUBGENRES = ['Isekai', 'Dark Fantasy', 'Reincarnation', 'Villainess', 'Martial Arts', 'Cultivation', 'Dungeon', 'Time Travel', 'Revenge', 'Shounen', 'Seinen', 'Shoujo', 'Josei', 'Iyashikei', 'Mecha', 'Cyberpunk', 'Vampire', 'Zombie', 'Magic', 'Super Power', 'Space', 'Historical', 'School']

/** The first sub-genre the record itself carries, or null. */
export function subgenreOf(item) {
  const own = new Set((item.tags || []).map((tag) => (typeof tag === 'string' ? tag : tag?.name)))
  return SUBGENRES.find((name) => own.has(name)) || null
}

/**
 * The hashtags of one title, most specific first: the title, its first
 * platform, its season, a sub-genre from its own tags, the kind of thing it
 * is, a genre, the community tags of that kind, the studio. Seven at most.
 * `t` is a title from source.mjs.
 */
export function tagsFor(t) {
  return uniqueTags([tagOf(baseTitle(t.title)) || tagOf(t.title), tagOf(t.platforms?.[0]), seasonTag(t.season), tagOf(t.subgenre), tagOf(t.section, { lower: true }), tagOf(t.genres?.[0], { lower: true }), ...(COMMUNITY_TAGS[t.section] || []), tagOf(t.studio)])
}

/** The story fields source.mjs puts on every title. */
export function storyOf(item) {
  return { rating: ratingOf(item.score), alt: altNameOf(item), native: nativeOf(item), synopsis: synopsisOf(item.description), tagline: taglineOf(item.description), subgenre: subgenreOf(item) }
}

/** A stable number from a string, so the same item always gets the same wording. */
export function hashOf(value) {
  let hash = 0
  for (const char of String(value)) hash = (hash * 31 + char.codePointAt(0)) >>> 0
  return hash
}
