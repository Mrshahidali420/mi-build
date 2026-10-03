/**
 * A show AniList still calls "not yet released" after its first episode aired.
 *
 * AniList's status can lag an episode by days (Overgeared aired 27 Sep 2026
 * and was marked releasing on 3 Oct). The record already holds the episode's
 * own air time, so once that time has passed the page treats the show as out.
 * Only an exact air time counts: a start date alone has no hour, and the show
 * stays "not out yet" until AniList says otherwise.
 *
 * Pure: a record and a time in, a record out (a copy when it changes).
 */
export function startedByClock(item, nowSec) {
  if (!item || item.kind !== 'anime' || item.status !== 'NOT_YET_RELEASED') return item
  const at = item.nextEpisode && Number(item.nextEpisode.at)
  if (!at || at > nowSec) return item
  // The stored "next" episode has aired, so it is no longer next.
  return { ...item, status: 'RELEASING', nextEpisode: null }
}
