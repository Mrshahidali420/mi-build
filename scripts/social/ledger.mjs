/**
 * The guard ledger: what the Page poster has claimed, posted or failed.
 *
 * Why it exists: on 4 Sep 2026 another poster published the same article
 * twice. Here the claim is written and pushed BEFORE the irreversible Graph
 * call, keyed `day|slug|page`, so a second run (a retry, an overlapping
 * schedule) finds the claim and stops. A failed post stays in the ledger as
 * `failed` and blocks that title like a real post: a failure after Facebook
 * accepted the photo must never turn into a second copy.
 *
 * Storage is a store with compare-and-swap: read() -> { data, version },
 * write(data, version, message) -> true, or false when someone else wrote
 * first. gitStore keeps ledger.json on the orphan branch `social-state`
 * (a plain push that is rejected when the branch moved is the swap);
 * memoryStore does the same in memory for dry runs and tests.
 */

export const LEDGER_BRANCH = 'social-state'
export const LEDGER_FILE = 'ledger.json'
export const TITLE_GAP_DAYS = 30
export const KEEP_DAYS = 90
const DAY_MS = 86_400_000
const CLAIM_TRIES = 6

export const emptyLedger = () => ({ v: 1, entries: [] })

export const keyOf = (day, slug, page) => `${day}|${slug}|${page}`

/** Title folded so "Solo Leveling" and "SOLO LEVELING!" are one title. */
export const normTitle = (title) =>
  String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The posting day, on the US East Coast clock the audience lives by. */
export function dayOf(ms, timeZone = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  return parts
}

/**
 * Why this entry may not be claimed, or null when it may.
 *
 * A classic entry (no `type`) is held to the 30-day title gap. A typed entry
 * (types/*.mjs) names its own `item` and `gapDays`: the same item of the same
 * type may not come back inside that gap, and the title gap applies to it
 * only when the type asks for it (`titleGap`). An episode post is the reason:
 * a weekly show must be able to post every week.
 */
export function guardReason(ledger, entry, now) {
  const entries = ledger?.entries || []
  if (entries.some((e) => e.key === entry.key)) return 'already claimed today'
  if (entry.type) {
    const gap = Number.isFinite(entry.gapDays) ? entry.gapDays : TITLE_GAP_DAYS
    const again = entries.find((e) => e.page === entry.page && e.type === entry.type && e.item === entry.item && e.at >= now - gap * DAY_MS)
    if (again) return `same ${entry.type} item ${again.status} on ${again.day}`
    if (!entry.titleGap || !entry.title) return null
  }
  const title = normTitle(entry.title)
  const since = now - TITLE_GAP_DAYS * DAY_MS
  const recent = entries.find((e) => e.page === entry.page && normTitle(e.title) === title && e.at >= since)
  if (recent) return `same title ${recent.status} on ${recent.day}`
  return null
}

/** Claims, posts and failures for one page on one day (dry runs never count). */
export const countDay = (ledger, day, page) =>
  (ledger?.entries || []).filter((e) => e.day === day && e.page === page && e.status !== 'dry').length

const prune = (entries, now) => entries.filter((e) => e.at >= now - KEEP_DAYS * DAY_MS)

/**
 * Write the claim. Returns { ok: true } or { ok: false, reason }.
 * A lost race re-reads the ledger and checks the guard again, so two runs
 * claiming the same title at once end with exactly one claim.
 */
export async function claim(store, entry, now) {
  for (let i = 0; i < CLAIM_TRIES; i += 1) {
    const { data, version } = await store.read()
    const reason = guardReason(data, entry, now)
    if (reason) return { ok: false, reason }
    const next = { ...data, entries: [...prune(data.entries || [], now), { ...entry, status: 'claimed' }] }
    if (await store.write(next, version, `Claim ${entry.key}`)) return { ok: true }
  }
  return { ok: false, reason: 'the ledger kept changing; nothing was claimed' }
}

/** Record how a claim ended (posted / failed) with its ids or error. */
export async function settle(store, key, patch) {
  for (let i = 0; i < CLAIM_TRIES; i += 1) {
    const { data, version } = await store.read()
    const entries = (data.entries || []).map((e) => (e.key === key ? { ...e, ...patch } : e))
    if (await store.write({ ...data, entries }, version, `${patch.status || 'Update'} ${key}`)) return true
  }
  return false
}

/** In-memory store with the same compare-and-swap rule. */
export function memoryStore(initial = emptyLedger()) {
  let state = { data: structuredClone(initial), version: 0 }
  return {
    async read() {
      return { data: structuredClone(state.data), version: state.version }
    },
    async write(data, version) {
      if (version !== state.version) return false
      state = { data: structuredClone(data), version: state.version + 1 }
      return true
    },
    snapshot: () => structuredClone(state.data),
  }
}

/**
 * The ledger on an orphan branch, written with git plumbing so no checkout
 * or worktree is touched. `git(args, input)` returns stdout and throws on a
 * non-zero exit (injectable for tests). The push is never forced: a branch
 * that moved since read() rejects it, which is the compare-and-swap.
 * Pushes made with the workflow's GITHUB_TOKEN start no other workflow, and
 * the deploy workflows only listen to master anyway.
 */
export function gitStore({ git, branch = LEDGER_BRANCH, file = LEDGER_FILE, remote = 'origin' }) {
  return {
    async read() {
      const heads = git(['ls-remote', '--heads', remote, branch]).trim()
      if (!heads) return { data: emptyLedger(), version: null }
      git(['fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`])
      const version = git(['rev-parse', `refs/remotes/${remote}/${branch}`]).trim()
      let data = emptyLedger()
      try {
        data = JSON.parse(git(['show', `${version}:${file}`]))
      } catch {
        data = emptyLedger()
      }
      return { data: { ...emptyLedger(), ...data }, version }
    },
    async write(data, version, message = 'Update ledger') {
      const blob = git(['hash-object', '-w', '--stdin'], `${JSON.stringify(data, null, 1)}\n`).trim()
      const tree = git(['mktree'], `100644 blob ${blob}\t${file}\n`).trim()
      const commit = git(['commit-tree', tree, ...(version ? ['-p', version] : []), '-m', message]).trim()
      try {
        git(['push', '--quiet', remote, `${commit}:refs/heads/${branch}`])
        return true
      } catch {
        return false
      }
    },
  }
}
