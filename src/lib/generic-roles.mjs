/**
 * Generic role "characters".
 *
 * AniList keeps one shared record called "Narrator" (id 36309) and credits it
 * on hundreds of unrelated shows. It is one AniList id, so the slug registry
 * rightly gives it one page, /character/narrator. But every one of those
 * stories then listed it in its cast, and the link count on 10 Oct 2026 was
 * 14,193 links into a page that is about nobody in particular.
 *
 * The page stays where it is (its address is registered and never moves). What
 * stops is the linking: a generic role that spans many stories is taken out
 * of each story's cast list at build time, so the title page, the cast page
 * and the costar lists no longer point at it.
 *
 * A narrator that belongs to one story (its own AniList id, one or two
 * appearances) is a real cast row of that story and is left alone. Pure.
 */

// A role name, not a person's name. Kept short on purpose: every name here
// must be one nobody would search for as a character.
const GENERIC_NAMES = new Set(['narrator', 'narration', 'announcer'])

// One shared record credited on at least this many titles is the generic
// one. A story's own narrator appears in that story and its sequels only.
export const GENERIC_MIN_TITLES = 10

const plain = (name) => String(name || '').trim().toLowerCase()

/** True for a role record shared by many unrelated stories. */
export function isGenericRole(person, minimum = GENERIC_MIN_TITLES) {
  if (!person || !GENERIC_NAMES.has(plain(person.name))) return false
  return (person.appearsIn || []).length >= minimum
}

/** The slugs of every generic role among the characters. */
export function genericRoleSlugs(characters, minimum = GENERIC_MIN_TITLES) {
  return new Set((characters || []).filter((p) => isGenericRole(p, minimum)).map((p) => p.slug))
}

/**
 * The same title with generic roles taken out of its cast. Returns the title
 * itself when nothing had to go, so an untouched record is never copied.
 */
export function withoutGenericCast(item, slugs) {
  const cast = item?.characters
  if (!Array.isArray(cast) || !slugs.size) return item
  const kept = cast.filter((ch) => !slugs.has(ch.slug))
  return kept.length === cast.length ? item : { ...item, characters: kept }
}
