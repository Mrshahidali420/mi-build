/**
 * Title tag and meta description for a title page with no official English
 * platform. BEING TESTED on a few pages first (META_TEST), 23 Oct 2026.
 *
 * Why. The old title promised "Read X Online — Official manga Sites & Apps",
 * and the description under it said "X has no official English reading
 * platform listed yet. Here is what we know about it." The title promised what
 * the page then said it did not have, and the description was one sentence
 * shared by thousands of pages. Seven such pages ranked in the top 8 with
 * under 5 clicks per 100 searches (28 days to 22 Oct).
 *
 * The test title says what the page really answers (English release status,
 * chapters) and carries the English name people also search by. The test
 * description is the page's own opening sentence, written from its facts
 * (src/lib/prose.mjs), so it differs on every page.
 *
 * Judge after three weeks (~13 Nov 2026): compare each page's click rate with
 * tasks/gsc-data/title-meta-test-baseline-2026-10-23.json. Roll out to every
 * no-English-platform title only if the test pages win.
 */

export const META_TEST = new Set([
  'manga/cool-na-eikoku-bishoujo-wa-orenchi-ni-homestay-shitai-rashii',
  'manga/ore-wa-benkyou-ga-shitai-dake-nanoni',
  'manga/black-swan',
  'manga/faceless-dropout',
  'manga/lens-no-mukou',
  'manga/mame-to-mugi',
  'manga/tokoro-de-machi-chuuka-wa-date-ni-irimasu-ka',
])

export const DESCRIPTION_MAX = 160

// Words that mark a name as English rather than romanised Japanese or Korean.
const ENGLISH_WORDS = /\b(the|a|an|my|me|i|is|to|with|of|and|in|you|your|wants|who|how|why|what|apparently|does|count|as|through)\b/i
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** The English name a reader may search by, when AniList lists one that is not the page's own title. */
export function englishAlias(item) {
  const own = norm(item.title)
  return (
    (item.synonyms || [])
      .map((s) => String(s).trim())
      .find((s) => /^[ -~]+$/.test(s) && s.includes(' ') && ENGLISH_WORDS.test(s) && norm(s) !== own) || ''
  )
}

const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1)

/** "Mame to Mugi Manga: English Release Status & Chapters", with the English name when there is one. */
export function noLinkTitle(item, word) {
  const alias = englishAlias(item)
  return `${item.title}${alias ? ` (${alias})` : ''} ${capital(word)}: English Release Status & Chapters`
}

/**
 * The page's own opening text, cut at a sentence end within DESCRIPTION_MAX;
 * the first sentence alone is cut at a word end. '' when there is no text.
 */
export function noLinkDescription(lede) {
  const text = String(lede || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  // Split only where a sentence end is followed by a space and a capital, so a
  // title ending in "!" or "?" ("Dake nanoni!, a Japanese...") stays whole.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
  let out = ''
  for (const s of sentences) {
    const next = `${out} ${s.trim()}`.trim()
    if (next.length > DESCRIPTION_MAX) break
    out = next
  }
  if (out) return out
  const cut = text.slice(0, DESCRIPTION_MAX - 1)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}
