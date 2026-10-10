/**
 * Sub or dub: whether an anime has an English dub, from its own cast list.
 *
 * Every anime record carries its characters with the voice AniList credits in
 * each language: `voice` for Japanese, `voiceEn` for English (both split out
 * of one voiceActorRoles list, scripts/anilist-core.mjs). The anime backfill
 * of 23 Sep 2026 filled both on every anime we hold.
 *
 *   dub   at least one character has an English voice credit
 *   sub   the Japanese cast is credited and no English voice is, on a record
 *         fetched since English voices were asked for (see below)
 *   null  anything else: we cannot tell, so the page says nothing
 *
 * A dub is only ever claimed from a credit. No credit is never read as "no
 * dub" unless the Japanese cast is there to show the list was filled in.
 *
 * Pure: a record in, an answer out.
 */

// How many English credits the FAQ answer names before it stops.
const NAMED_IN_ANSWER = 3

/** { state: 'dub' | 'sub', english: [{ name, voice }] }, or null when the record has no voice credits. */
export function dubOf(item) {
  if (!item || item.kind !== 'anime') return null
  const cast = (item.characters || []).filter((c) => c && c.name)
  const english = cast.filter((c) => c.voiceEn).map((c) => ({ name: c.name, voice: c.voiceEn }))
  if (english.length) return { state: 'dub', english }
  // A show still to come or still airing often gets its English cast credited
  // late, even when the dub streams the same day; "Sub only" there would be a
  // guess, so only a finished show can be called subtitled only.
  if (item.status !== 'FINISHED') return null
  // "No English credit" only means something on a record fetched since the
  // English voices were asked for. The staff credits arrived in that same
  // change (23 Sep 2026), so a record that has them was fetched with it; an
  // older copy without them says nothing rather than claim there is no dub.
  const askedForEnglish = Array.isArray(item.staff) && item.staff.length > 0
  if (askedForEnglish && cast.some((c) => c.voice)) return { state: 'sub', english: [] }
  return null
}

/** The short label the title page shows. */
export function dubLabel(dub) {
  if (!dub) return ''
  return dub.state === 'dub' ? 'English dub' : 'Subtitled only — no English dub cast listed'
}

const listWords = (names) =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** "Is X dubbed in English?", or null when the record cannot answer it. */
export function dubFaq(item) {
  const dub = dubOf(item)
  if (!dub) return null
  const q = `Is ${item.title} dubbed in English?`
  if (dub.state === 'sub') {
    const lead = (item.characters || []).find((c) => c && c.role === 'MAIN' && c.voice)
    return {
      q,
      a:
        `AniList lists no English dub cast for ${item.title}, only the Japanese one${lead ? `, led by ${lead.voice} as ${lead.name}` : ''}, ` +
        `so as far as we can tell it is watched in Japanese with subtitles.`,
    }
  }
  const named = dub.english.slice(0, NAMED_IN_ANSWER).map((c) => `${c.voice} voices ${c.name}`)
  return {
    q,
    a:
      // Only this cast: the general "check the audio options" line read the
      // same on every dubbed show.
      `Yes, AniList lists an English dub cast for ${item.title}: ${listWords(named)}.`,
  }
}
