/**
 * Build-time facts for character pages, worked out across every character at
 * once (the Worker only ever holds one record, so it cannot do this):
 *
 *   appearsIn[].year  the start year of each title the character is in
 *   costars           up to 4 characters who share the most titles with this
 *                     one, at least 2 shared (one shared title is already the
 *                     page's "Other characters in ..." block)
 *   vaOther           up to 3 other characters voiced by the same voice,
 *                     most favourited first, each with a page of its own:
 *                     the Japanese voice's first, then the English dub's
 *                     ("en": 1). The voice's name is not stored again: the
 *                     page reads it off the appearsIn rows, as it always has.
 *
 * Called by scripts/make-shards.mjs on the characters that earn a page, and
 * by scripts/measure-characters.mjs on the same records. Pure: no I/O, and it
 * returns new records instead of changing the ones it is given.
 */
import { sectionOf } from './section.mjs'
import { isGenericRole } from './generic-roles.mjs'
import { titleKey } from './shard-key.js'
import { displayName } from './names.mjs'
import { voicesOf } from './character-page.mjs'

/**
 * The thinnest character pages (owner decision, 10 Oct 2026, after the
 * September 2026 spam update and the AdSense and Ezoic rejections): no bio,
 * no voice actor in any appearance, and exactly one title. Such a page has
 * nothing the title's own cast list does not already say.
 */
export function isThinCharacter(rec) {
  const rows = rec?.appearsIn || []
  return !String(rec?.description || '').trim() && rows.length === 1 && !rows.some((a) => a && (a.voice || a.voiceEn))
}

/**
 * Off since 21 Oct 2026 (owner decision): thin pages are made fuller, never
 * hidden. The 10 Oct noindex took about 190,000 pages out of Google, and the
 * same move on WhereAnime cut its impressions by 99%. While this is false,
 * no character page, character /buy page or title sub-page is noindexed and
 * every one of them is back in the sitemap. The thin rules stay, so the pages
 * that most need more facts can still be found.
 */
export const HIDE_THIN_PAGES = false

/**
 * Thin, and not on the keep list: the page answers with
 * <meta name="robots" content="noindex, follow"> and leaves the sitemap. A
 * thin page Google already shows (data/index-keep.json: any impression in the
 * last 90 days) stays indexed. Never true while HIDE_THIN_PAGES is false.
 * @param keep Set of "/character/<slug>" paths
 */
export const isNoindexCharacter = (rec, keep = new Set()) =>
  HIDE_THIN_PAGES && isThinCharacter(rec) && !keep.has(`/character/${rec.slug}`)

export const COSTARS_MAX = 4
export const COSTARS_MIN_SHARED = 2
export const VA_OTHER_MAX = 3

const keyOfRow = (row) => titleKey(sectionOf(row), row.slug)
const nameOf = (person) => displayName(person).primary || person.name
const byFame = (a, b) => (b.favourites || 0) - (a.favourites || 0) || String(a.slug).localeCompare(String(b.slug))

/** title key -> start year, from the title records. */
export function yearsOf(titles) {
  const years = new Map()
  for (const t of titles) if (t && t.slug && t.startYear) years.set(titleKey(sectionOf(t), t.slug), t.startYear)
  return years
}

/**
 * title key -> indexes of the characters in it. A generic role shared by many
 * unrelated stories ("Narrator", src/lib/generic-roles.mjs) is nobody's
 * costar, so it is left out here and in the voice index below.
 */
function membersOf(people) {
  const members = new Map()
  people.forEach((person, i) => {
    if (isGenericRole(person)) return
    for (const key of new Set((person.appearsIn || []).map(keyOfRow))) {
      if (!members.has(key)) members.set(key, [])
      members.get(key).push(i)
    }
  })
  return members
}

function costarsOf(i, people, members) {
  const counts = new Map()
  for (const key of new Set((people[i].appearsIn || []).map(keyOfRow))) {
    for (const j of members.get(key) || []) if (j !== i) counts.set(j, (counts.get(j) || 0) + 1)
  }
  return [...counts]
    .filter(([, n]) => n >= COSTARS_MIN_SHARED)
    .sort(([a, n], [b, m]) => m - n || byFame(people[a], people[b]))
    .slice(0, COSTARS_MAX)
    .map(([j, n]) => ({ slug: people[j].slug, name: nameOf(people[j]), n }))
}

/** voice name -> the most favourited characters it voices. One index per language. */
function voiceIndex(people, field) {
  const index = new Map()
  people.forEach((person, i) => {
    if (isGenericRole(person)) return
    for (const voice of new Set((person.appearsIn || []).map((row) => row[field]).filter(Boolean))) {
      if (!index.has(voice)) index.set(voice, [])
      index.get(voice).push(i)
    }
  })
  // Only the head of each list is ever read: a character needs three others.
  for (const [voice, list] of index) {
    index.set(voice, list.sort((a, b) => byFame(people[a], people[b])).slice(0, VA_OTHER_MAX + 1))
  }
  return index
}

function othersVoiced(i, voice, index, people, en) {
  if (!voice) return []
  const own = nameOf(people[i]).toLowerCase()
  return (index.get(voice) || [])
    .filter((j) => j !== i && nameOf(people[j]).toLowerCase() !== own)
    .map((j) => ({ slug: people[j].slug, name: nameOf(people[j]), ...(en ? { en: 1 } : {}) }))
}

/**
 * The records with the three new fields. Fields with nothing to say are left
 * out, so a record that gains nothing stays the same size.
 */
export function attachCharacterFacts(people, titles) {
  const years = yearsOf(titles)
  const members = membersOf(people)
  const jp = voiceIndex(people, 'voice')
  const en = voiceIndex(people, 'voiceEn')
  return people.map((person, i) => {
    // Worked out fresh every time: a record that already carries the fields
    // (a shard read back by the measure) must not keep a stale list.
    const { costars: _oldCostars, vaOther: _oldVaOther, ...rest } = person
    const appearsIn = (person.appearsIn || []).map((row) => {
      const year = years.get(keyOfRow(row))
      return year && row.year !== year ? { ...row, year } : row
    })
    const costars = costarsOf(i, people, members)
    const voices = voicesOf(person.appearsIn || [])
    const jpVoice = voices.find((v) => v.lang === 'Japanese')?.name
    const enVoice = (person.appearsIn || []).find((row) => row.voiceEn)?.voiceEn
    const seen = new Set()
    const vaOther = [...othersVoiced(i, jpVoice, jp, people, false), ...othersVoiced(i, enVoice, en, people, true)]
      .filter((v) => !seen.has(v.slug) && seen.add(v.slug))
      .slice(0, VA_OTHER_MAX)
    return {
      ...rest,
      appearsIn,
      ...(costars.length ? { costars } : {}),
      ...(vaOther.length ? { vaOther } : {}),
    }
  })
}
