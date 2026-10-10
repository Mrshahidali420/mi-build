/**
 * Build-time facts for a title's cast page (/<kind>/<slug>/characters), read
 * off the character records make-shards.mjs already holds, so the Worker never
 * loads a character shard to draw that page:
 *
 *   characters[i].more  for a lead with a page: how many other titles AniList
 *                       lists them in ({ n }), and the best known one ({ top })
 *   characters[i].va    for a lead: the best-known other role of the same
 *                       voice ({ slug, name, en? }), from character-facts.mjs
 *   castFacts.top       the most favourited face of the cast
 *   castFacts.shared    the prequels and sequels (item.chain) that share cast
 *                       with this title, and how many faces they share
 *
 * Only for titles that earn a cast page (gates.mjs hasCastPage). Pure: it
 * returns a new record and never changes the one it is given.
 */
import { sectionOf } from './section.mjs'
import { titleKey } from './shard-key.js'
import { hasCastPage } from './gates.mjs'

const keyOf = (row) => titleKey(sectionOf(row), row.slug)
export const SHARED_MAX = 2

/** slug -> character record (with Step 3 fields), and each record's title keys. */
export function castContext(people) {
  const bySlug = new Map()
  const keysOf = new Map()
  for (const p of people) {
    bySlug.set(p.slug, p)
    keysOf.set(p.slug, new Set((p.appearsIn || []).map(keyOf)))
  }
  return { bySlug, keysOf }
}

const bestOf = (rows) => rows.reduce((a, b) => (!a || (b.popularity || 0) > (a.popularity || 0) ? b : a), null)

function leadFacts(person, ownKey, ownTitle) {
  const others = (person.appearsIn || []).filter((row) => keyOf(row) !== ownKey)
  // The best known title with a name of its own; when every other title
  // shares this one's name (Solo Leveling and its anime), its medium is kept
  // so the page can say "the anime Solo Leveling".
  const best = bestOf(others.filter((row) => row.title !== ownTitle)) || bestOf(others)
  const va = (person.vaOther || [])[0]
  return {
    more: best ? { n: others.length, top: best.title, ...(best.title === ownTitle ? { kind: sectionOf(best) } : {}) } : { n: 0 },
    ...(va ? { va } : {}),
  }
}

export function withCastFacts(item, { bySlug, keysOf }) {
  if (!hasCastPage(item)) return item
  const ownKey = keyOf(item)
  const characters = (item.characters || []).map((c) => {
    const person = c.role === 'MAIN' && bySlug.get(c.slug)
    return person ? { ...c, ...leadFacts(person, ownKey, item.title) } : c
  })
  const known = (item.characters || []).map((c) => bySlug.get(c.slug)).filter(Boolean)
  const top = known.reduce((a, b) => ((b.favourites || 0) > (a?.favourites || 0) ? b : a), null)
  const shared = (item.chain || [])
    .filter((part) => !part.self && part.slug)
    .map((part) => {
      const key = titleKey(part.kind, part.slug)
      const n = known.filter((p) => keysOf.get(p.slug)?.has(key)).length
      return { slug: part.slug, kind: part.kind, title: part.title, n }
    })
    .filter((part) => part.n > 0)
    .sort((a, b) => b.n - a.n || a.slug.localeCompare(b.slug))
    .slice(0, SHARED_MAX)
  const castFacts = {
    // Named as the cast list names them, so the page says one name per face.
    ...(top && top.favourites > 0
      ? { top: { slug: top.slug, name: characters.find((c) => c.slug === top.slug)?.name || top.name, favourites: top.favourites } }
      : {}),
    ...(shared.length ? { shared } : {}),
  }
  return { ...item, characters, ...(Object.keys(castFacts).length ? { castFacts } : {}) }
}
