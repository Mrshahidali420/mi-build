/**
 * Finished clips for the Page, made by the recap project (tools/publish_clips.py).
 *
 * The recap project cuts a trending episode into branded clips, uploads them to the private
 * release `clips` of <owner>/recap-assets, and lists them in clips/<page>.json there.
 * This file reads that list and downloads one file. It needs CLIPS_TOKEN (read access to that
 * repo); without it the clip kinds simply have nothing to post.
 *
 * Env: CLIPS_TOKEN, CLIPS_OWNER (default Mrshahidali420), CLIPS_PAGE (default whereanime).
 */
const API = 'https://api.github.com'
const MAX_AGE_DAYS = 4

const headers = (token, accept) => ({ Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'page-poster' })

/** The clips on offer for this Page, newest first. Never throws: a store that cannot be read is an empty list. */
export async function loadClips({ env = process.env, fetch = globalThis.fetch, now = Date.now() } = {}) {
  const token = env.CLIPS_TOKEN
  if (!token) return { items: [], note: 'no CLIPS_TOKEN' }
  const owner = env.CLIPS_OWNER || 'Mrshahidali420'
  const page = env.CLIPS_PAGE || 'whereanime'
  try {
    const res = await fetch(`${API}/repos/${owner}/recap-assets/contents/clips/${page}.json`, { headers: headers(token, 'application/vnd.github.raw') })
    if (res.status === 404) return { items: [], note: 'no clips yet' }
    if (!res.ok) return { items: [], note: `clip list: HTTP ${res.status}` }
    const { items = [] } = await res.json()
    const fresh = items.filter((it) => now - it.made_at * 1000 < MAX_AGE_DAYS * 86_400_000).sort((a, b) => b.made_at - a.made_at)
    return { items: fresh, owner, note: `${fresh.length} clips` }
  } catch (error) {
    return { items: [], note: `clip list: ${error.message}` }
  }
}

/** One clip file as bytes. `which` is 'short' or 'full'. */
export async function downloadClip(item, which, { env = process.env, fetch = globalThis.fetch } = {}) {
  const id = which === 'full' ? item.full_id : item.short_id
  const owner = env.CLIPS_OWNER || 'Mrshahidali420'
  const res = await fetch(`${API}/repos/${owner}/recap-assets/releases/assets/${id}`, { headers: headers(env.CLIPS_TOKEN, 'application/octet-stream'), redirect: 'follow' })
  if (!res.ok) throw new Error(`the ${which} clip could not be downloaded (HTTP ${res.status})`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length < 100_000) throw new Error(`the ${which} clip is too small (${bytes.length} bytes)`)
  return bytes
}
