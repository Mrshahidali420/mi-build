/**
 * The picture a post carries: the largest cover the source has.
 *
 * AniList keeps each cover in three folders (small, medium, large) and only
 * the folder changes between them. The catalog already stores the biggest
 * file AniList has, and that was checked against live addresses on
 * 12 Oct 2026: every record that holds a `medium` address is an older title
 * whose `large` file does not exist (404). Those covers are 230 px wide and
 * look soft in the feed, so the picker passes them over while a title with a
 * large cover (460 px) is on offer.
 *
 * resolveCover() still asks for the large file before any small one is used,
 * and keeps the old address when the large one is not there. Nothing here
 * guesses a file name: only the folder is swapped.
 */

const FOLDER = /\/cover\/(small|medium|large)\//
export const BIG_FOLDER = 'large'
const HEAD_TIMEOUT_MS = 8000

/** 'small' | 'medium' | 'large', or null for an address that has no size folder. */
export const coverFolder = (url) => String(url || '').match(FOLDER)?.[1] || null

/** True only for a cover known to be one of the small files. */
export const isSmallCover = (url) => {
  const folder = coverFolder(url)
  return folder !== null && folder !== BIG_FOLDER
}

/** The same file in the large folder, or null when there is nothing to swap. */
export const largeCoverOf = (url) => (isSmallCover(url) ? String(url).replace(FOLDER, `/cover/${BIG_FOLDER}/`) : null)

/** Candidates with a large cover when there are any; otherwise all of them. */
export function preferBigCovers(list) {
  const big = list.filter((c) => !isSmallCover(c.image))
  return big.length ? big : list
}

async function exists(url, fetch) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) })
    return res.ok && /^image\//i.test(res.headers?.get?.('content-type') || '')
  } catch {
    return false
  }
}

/**
 * The address to post: the large file when it really exists, else the address
 * the record holds.
 * @returns {Promise<{ url: string, small: boolean }>}
 */
export async function resolveCover(url, { fetch = globalThis.fetch } = {}) {
  const large = largeCoverOf(url)
  if (!large) return { url, small: false }
  return (await exists(large, fetch)) ? { url: large, small: false } : { url, small: true }
}
