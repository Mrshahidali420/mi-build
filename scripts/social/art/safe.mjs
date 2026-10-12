/**
 * The safety gate every fan art and cosplay picture passes before it can be
 * posted (owner decision, 12 Oct 2026: mild fan service is allowed, nudity
 * is not). Facebook, not copyright, is what can take a Page down.
 *
 *   1. Rating: only the source's own "general" or "sensitive" (Danbooru g
 *      and s). Questionable, explicit, any NSFW or mature flag, or no rating
 *      at all: out.
 *   2. Nudity and sex: any tag in NUDITY, or a nudity word in a tag, the
 *      character names or the post's own text: out.
 *   3. The hard line, whatever else is allowed: never a character who is or
 *      looks like a minor next to anything suggestive. MINOR tags are out
 *      always; a school-age tag (school uniform, student) together with a
 *      suggestive tag is out too.
 *
 * What is left is either plain, or "ecchi-leaning" (rated sensitive, or a
 * suggestive tag that is still allowed): ecchiOf() says which, so the Page
 * can keep those to one art post in four (art/load.mjs).
 *
 * Pure: every adapter (art/*.mjs) hands its items here in the common shape
 * ({ rating, tags: [...], characters, text, flagged, nsfw }).
 */

/** Ratings that may be posted, in each source's own words. */
export const SAFE_RATINGS = new Set(['g', 'general', 'safe', 's', 'sensitive'])
/** The ratings among them that lean ecchi. */
const SENSITIVE = new Set(['s', 'sensitive'])

/** Nudity and sex (Danbooru spelling: lower case, words joined by _). */
export const NUDITY = new Set([
  'nude', 'completely_nude', 'nearly_nude', 'naked', 'topless', 'bottomless', 'nipples', 'areolae', 'areola_slip', 'nipple_slip', 'pussy', 'penis', 'testicles', 'genitals', 'anus', 'uncensored', 'censored', 'mosaic_censoring', 'bar_censor', 'convenient_censoring', 'novelty_censor',
  'pubic_hair', 'female_pubic_hair', 'male_pubic_hair', 'sex', 'vaginal', 'anal', 'oral', 'fellatio', 'cunnilingus', 'paizuri', 'handjob', 'masturbation', 'fingering', 'groping', 'cum', 'after_sex', 'sex_toy', 'vibrator', 'dildo', 'erection',
  'bdsm', 'bondage', 'shibari', 'tentacle_sex', 'rape', 'see-through', 'see-through_clothes', 'implied_sex', 'imminent_sex', 'pasties', 'maebari', 'nude_cover', 'breasts_out', 'cameltoe',
  // undressing reads as nudity at a glance: out too
  'torn_clothes', 'undressing', 'clothes_pull', 'shirt_lift', 'skirt_lift', 'bare_back', 'partially_undressed', 'open_shirt', 'naked_shirt', 'naked_apron', 'strategically_censored',
])
/** Any of these words inside a tag, a name or the post's text means the same. */
const NUDITY_WORDS = /(^|[_\s])(nude|naked|nsfw|hentai|sex|porn|genitals?|nipples?|pussy|penis|uncensored|topless|bottomless)($|[_\s])/

/** Minors: out always, with or without anything else. */
export const MINOR = new Set(['loli', 'lolicon', 'shota', 'shotacon', 'child', 'children', 'toddler', 'baby', 'underage', 'young', 'aged_down', 'kindergarten_uniform', 'elementary_school', 'randoseru'])
/** School age: out only together with a suggestive tag. */
export const SCHOOL_AGE = new Set(['school_uniform', 'serafuku', 'schoolgirl', 'schoolboy', 'student', 'gym_uniform', 'school_swimsuit', 'middle_school_uniform', 'buruma', 'kogal'])
/** Allowed, but suggestive: these make a picture ecchi-leaning, and never go with SCHOOL_AGE. */
export const SUGGESTIVE = new Set([
  'swimsuit', 'one-piece_swimsuit', 'bikini', 'micro_bikini', 'cleavage', 'panties', 'pantyshot', 'underwear', 'underwear_only', 'bra', 'lingerie', 'ecchi', 'fanservice', 'sideboob', 'underboob', 'large_breasts', 'huge_breasts', 'breast_focus', 'ass', 'ass_focus', 'thigh_focus', 'thighs', 'thick_thighs',
  'skindentation', 'leotard', 'playboy_bunny', 'bunnysuit', 'navel', 'midriff', 'towel', 'bath', 'bathing', 'onsen', 'wet_clothes', 'covered_nipples', 'spread_legs', 'garter_straps', 'lying_on_bed', 'suggestive',
])

const tagsOf = (item) => (item.tags || []).map((tag) => String(tag).toLowerCase())

/** Why a picture may not be posted, or null when it may. */
export function unsafeReason(item) {
  if (!item) return 'no picture'
  if (item.nsfw || item.mature || item.over18) return 'marked NSFW at the source'
  if (!item.rating) return 'the source gives no rating'
  if (!SAFE_RATINGS.has(String(item.rating).toLowerCase())) return `rated ${item.rating}`
  if (item.flagged) return 'flagged at the source'
  const tags = tagsOf(item)
  const minor = tags.find((tag) => MINOR.has(tag))
  if (minor) return `tag ${minor}`
  const nude = tags.find((tag) => NUDITY.has(tag) || NUDITY_WORDS.test(tag))
  if (nude) return `tag ${nude}`
  const words = [...(item.characters || []), item.text || ''].join(' ').toLowerCase()
  if (NUDITY_WORDS.test(words)) return 'nudity in the text'
  const school = tags.find((tag) => SCHOOL_AGE.has(tag))
  const suggestive = tags.find((tag) => SUGGESTIVE.has(tag))
  if (school && (suggestive || SENSITIVE.has(String(item.rating).toLowerCase()))) return `school age (${school}) with ${suggestive || 'a sensitive rating'}`
  return null
}

export const isSafe = (item) => unsafeReason(item) === null

/** True for a safe picture that leans ecchi: rated sensitive, or carrying a suggestive tag. */
export const ecchiOf = (item) => SENSITIVE.has(String(item?.rating || '').toLowerCase()) || tagsOf(item || {}).some((tag) => SUGGESTIVE.has(tag))
