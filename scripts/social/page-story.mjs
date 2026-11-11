/**
 * A clip reel also goes out as a Story: a Facebook Page Story and an Instagram Story, the same video.
 * (Owner decision, 11 Nov 2026: stories for the best clips only, a few a day.)
 *
 * FB_STORIES_PER_DAY: stories in any 24 hours, counted from the ledger (`story` on an entry). Unset or 0 = off.
 * A story never stops anything: a failure is written to the ledger and the run goes on.
 * The Graph API cannot put a link sticker on a story, so a story carries no link.
 */
import { settle } from './ledger.mjs'
import { DAY_MS } from './pace.mjs'
import { IG_UPLOAD_MAX_SECONDS, trimVideo } from './ig.mjs'

/** The kinds that also go out as a story. */
export const STORY_KINDS = new Set(['clip-reel'])

export const storiesPerDayOf = (value) => {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 0
}

/** Stories made in the last 24 hours. */
export const storiesToday = (history, now) => history.filter((e) => e.story && e.story.at > now - DAY_MS).length

export async function postStory({ graph, ig, book, entry, history = [], now, out, bytes, seconds, sleep, perDay, trim = trimVideo }) {
  if (!STORY_KINDS.has(entry.type) || !perDay || !bytes?.length) return null
  if (storiesToday(history, now) >= perDay) return null
  const done = { at: now }
  try {
    if (graph.publishStory) done.fb = (await graph.publishStory({ bytes })).storyId
  } catch (error) {
    done.fbError = error.message
  }
  try {
    if (ig && !ig.off && !ig.settings?.checkOnly && ig.client?.publishStory) {
      const small = Number(seconds) > IG_UPLOAD_MAX_SECONDS ? await trim(bytes, IG_UPLOAD_MAX_SECONDS) : bytes
      done.ig = (await ig.client.publishStory({ bytes: small, sleep })).mediaId
    }
  } catch (error) {
    done.igError = error.message
  }
  await settle(book, entry.key, { story: done }).catch(() => null)
  out.push(`Story: Facebook ${done.fb || `failed (${done.fbError || 'not available'})`}; Instagram ${done.ig || `failed (${done.igError || 'not used'})`}.`, '')
  return done
}
