/**
 * Pure helpers for the character page (src/pages/character/[slug].astro).
 *
 * Kept out of the page so they can be tested, and kept cheap: a character
 * page is drawn by the Worker on request, so everything here is one pass over
 * rows the page already holds.
 */
import { sectionOf } from './section.mjs'

/** How many rows of one group show before the "Show all" fold. */
export const SHOWN_PER_GROUP = 6

const GROUP_ORDER = ['anime', 'comic', 'novel']
const COMIC_WORDS = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' }

/** The group an appearance row belongs to: anime, comic or novel. */
export const groupOf = (row) => {
  const section = sectionOf(row || {})
  if (section === 'anime' || section === 'novel') return section
  return 'comic'
}

/**
 * The plain role word under a title: "Main", "Supporting" or "Appears".
 * Small text, never a capital-letter badge.
 */
export const roleWord = (role) =>
  role === 'MAIN' ? 'Main' : role === 'SUPPORTING' ? 'Supporting' : 'Appears'

/**
 * Every appearance, grouped anime / comic / novel in the order the record
 * already holds them. Each group splits into `shown` (the first few) and
 * `folded` (the rest, still in the HTML behind a fold). A comic group is
 * named by its own word ("Manhwa") when every row shares one, else "Comics".
 */
export function groupAppearances(rows = [], shown = SHOWN_PER_GROUP) {
  const groups = new Map()
  for (const row of rows) {
    const key = groupOf(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return GROUP_ORDER.filter((key) => groups.has(key)).map((key) => {
    const list = groups.get(key)
    let label = key === 'anime' ? 'Anime' : 'Novels'
    if (key === 'comic') {
      const words = new Set(list.map((row) => sectionOf(row)))
      label = words.size === 1 ? COMIC_WORDS[[...words][0]] || 'Comics' : 'Comics'
    }
    return { key, label, rows: list, shown: list.slice(0, shown), folded: list.slice(shown) }
  })
}

/**
 * The voices for the hero's facts line: Japanese first, then English, each
 * with its WhereAnime slug when the sister site has a page. The same person
 * in both languages is named once.
 */
export function voicesOf(appearsIn = []) {
  const jp = appearsIn.find((a) => a.voice)
  const en = appearsIn.find((a) => a.voiceEn)
  const out = []
  if (jp) out.push({ name: jp.voice, lang: 'Japanese', where: jp.voiceWhere || '' })
  if (en && (!jp || en.voiceEn !== jp.voice)) {
    out.push({ name: en.voiceEn, lang: 'English', where: en.voiceEnWhere || '' })
  }
  return out
}

/** "Main character in", "Supporting character in" or "Character in". */
export const rolePhrase = (role) =>
  role === 'MAIN' ? 'Main character in' : role === 'SUPPORTING' ? 'Supporting character in' : 'Character in'

/** "Appears in 9 titles" / "Appears in 1 title". */
export const countPhrase = (n) => `Appears in ${n} ${n === 1 ? 'title' : 'titles'}`

/**
 * The facts table rows that the hero line does not already say. The hero
 * names the lead title, the voices and the title count, so those rows leave
 * the table; everything else stays, in the same order.
 */
const HERO_SAYS = new Set(['Japanese voice', 'English voice', 'From', 'Appears in'])
export const factsBelowHero = (facts = []) => facts.filter(([term]) => !HERO_SAYS.has(term))
