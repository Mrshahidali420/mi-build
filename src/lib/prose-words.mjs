/**
 * The shared vocabulary of the title-page prose writer (src/lib/prose.mjs):
 * the blocked tags, the word tables and the small helpers every fact module
 * uses. Pure: no I/O.
 */

import { FREE } from './platform-facts.js'

// Tags that must never reach a page, whatever AniList says about them.
export const BLOCKED_TAGS = new Set([
  'Ecchi', 'Nudity', 'Sexual Content', 'Boys Love', 'Girls Love', 'Yaoi', 'Yuri',
  'Incest', 'Lolicon', 'Shotacon', 'Tentacles', 'Prostitution', 'Rape',
  'Sexual Abuse', 'Netorare', 'Netorase', 'Harem', 'Reverse Harem', 'Fetish',
  'Bondage', 'Cross-Dressing', 'Gender Bending', 'Adult', 'Hentai', 'Erotica',
  'Sex Work', 'Teacher', 'Age Gap', 'Cheating', 'Psychosexual', 'Suicide',
  'Self-Harm', 'Gore', 'Torture', 'Cannibalism', 'Drugs', 'Body Horror',
  'Guro', 'Sadism', 'Masochism', 'Slavery', 'Human Trafficking',
])
export const isBlocked = (name) => BLOCKED_TAGS.has(name) || /boys' love|girls' love/i.test(name || '')

export const COUNTRY_WORDS = { KR: 'Korean', CN: 'Chinese', TW: 'Taiwanese', JP: 'Japanese' }
export const SEASON_WORDS = { WINTER: 'winter', SPRING: 'spring', SUMMER: 'summer', FALL: 'autumn' }
export const SECTION_WORDS = { manhwa: 'manhwa', manga: 'manga', manhua: 'manhua', novel: 'novel', anime: 'anime' }
export const SHOW_WORDS = {
  TV: 'TV anime',
  TV_SHORT: 'short TV anime',
  MOVIE: 'anime film',
  OVA: 'OVA',
  ONA: 'web anime',
  SPECIAL: 'anime special',
  MUSIC: 'music video',
}
export const SOURCE_WORDS = {
  MANGA: 'a manga',
  LIGHT_NOVEL: 'a light novel',
  WEB_NOVEL: 'a web novel',
  NOVEL: 'a novel',
  VISUAL_NOVEL: 'a visual novel',
  VIDEO_GAME: 'a video game',
  GAME: 'a game',
  PICTURE_BOOK: 'a picture book',
}
export const REGION_WORDS = { 'Some countries': 'some countries only', 'US and Canada': 'the US and Canada' }
export const RELATIVE_WORDS = { SIDE_STORY: ['side story', 'side stories'], SPIN_OFF: ['spin-off', 'spin-offs'], ALTERNATIVE: ['alternative version', 'alternative versions'] }

// How a platform note maps to a bucket a reader actually cares about.
export const BUCKET_OF_NOTE = {
  'Free, ad-supported': 'free',
  'Free, official': 'free',
  'Free, official channel': 'free',
  'Free episodes': 'free',
  'Free tier': 'free',
  'Free tier and premium': 'free',
  'Free with timer': 'timer',
  'Free with coins': 'coins',
  'Free with library card': 'library',
  Subscription: 'subscription',
  'Paid chapters': 'paid',
  'Buy in print': 'print',
}

// How much a platform gives away, most generous first.
export const FREE_DEPTH = [
  [FREE.ALL, 'has all of it free'],
  [FREE.MOST, 'has most of it free'],
  [FREE.EARLY, 'keeps everything but the newest chapters free'],
  [FREE.SOME, 'gives the first chapters free'],
  [FREE.SOME_EP, 'gives the first episodes free'],
  [FREE.TIMER, 'unlocks one chapter at a time on a free timer'],
]

/** "A", then "A and B", then "A, B and C". */
export function joinWords(list) {
  const clean = list.filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  return clean.slice(0, -1).join(', ') + ' and ' + clean[clean.length - 1]
}

export const unique = (list) => [...new Set((list || []).filter(Boolean))]
export const plural = (n, one, many) => (n === 1 ? one : many)
export const big = (n) => Number(n).toLocaleString('en-GB')
export const quoted = (text) => `“${text}”`
// "an 8-chapter", "an 11-chapter": numbers are said out loud.
export const article = (word) => (/^[aeiou]/i.test(word) || /^(8|11|18)(?!\d)|^8\d/.test(word) ? 'an' : 'a')
export const capital = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)
export const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
export const fact = (key, weight, sentence) => ({ key, weight, sentence })

export const safeTags = (item, limit) => (item.tags || []).filter((t) => !isBlocked(t)).slice(0, limit)
export const safeGenres = (item, limit) => (item.genres || []).filter((g) => !isBlocked(g)).slice(0, limit)

export const linksOf = (item, kind) => ((kind === 'anime' ? item.watchLinks : item.readLinks) || []).filter((l) => l && l.site)
