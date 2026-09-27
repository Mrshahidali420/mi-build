/**
 * "People are searching for": the homepage shelf that follows what people
 * search for, from our own numbers (owner's design, 27 Sep 2026). On the
 * homepage it is called "Hot this week" and each cover just says so: the
 * owner does not want Google or any count on a public card. The numbers
 * (search-engine arrivals and our own searches) are shown in /my-admin only.
 * Pure, like the rest of the planner; src/lib/home-plan.mjs runs it with the same
 * brakes as every other shelf (safety, block and ban lists, one cover per
 * page, the nightly change cap, minimum and maximum stay, cooldown, flap
 * freeze, and the closed-loop drop).
 *
 * Two ways in, either is enough:
 *   - Search engines: this week's arrivals from Google, Bing and the rest,
 *     against the title's usual (over the days the counter really has, as
 *     Rising does). A title people have always found on Google is not news;
 *     one they suddenly search for is.
 *   - Our own search box: distinct people who picked the title in a search,
 *     or typed exactly its name. Rarer, and a stronger sign, so it weighs
 *     more per person.
 *
 * Per-title numbers (built by scripts/plan-home.mjs):
 *   g1, g7, g30    arrivals from a search engine: yesterday, 7 days, 30 days
 *   gPeople7       distinct people behind the 7-day arrivals (true distinct)
 *   gDays7         days of the 7 with an arrival
 *   gGoogle7       how many of the 7-day arrivals were Google
 *   s7, sPeople7, sDays7   searches on our own box: rows, distinct people, days
 *   entries7, quick7       from the page rows, for the quick-exit brake
 *
 * Two modes (owner's call, 27 Sep 2026). Search arrivals were first counted
 * on 19 Sep, and a "usual" needs weeks behind it, so the rise rule would keep
 * the shelf empty for a fortnight. While the arrivals table holds fewer than
 * 28 days, the shelf ranks by volume instead: distinct people from search
 * engines plus distinct people on our own search box, this week. Every other
 * floor and brake is the same in both modes. From 28 days on it switches back
 * to the rise by itself. The planner picks the mode (searchModeOf) and passes
 * it in ctx.searchMode; with no mode given, the rise rule applies.
 */

export const SEARCHING_SECTION = {
  title: 'Hot this week',
  why: 'Titles more people are looking for this week.',
  slots: 12,
  // Search arrivals are spread thin over many titles, so four is a shelf.
  floor: 4,
  cap: 3,
  minStay: 3,
  maxStay: 14,
  cooldown: 7,
}

// webPeople7 and sitePeople7 are ceilings: the planner scales them to the
// site's traffic each night (src/lib/home-floors.mjs) and passes them in
// ctx.floors.
export const SEARCHING = {
  // Distinct people who arrived from a search engine this week.
  webPeople7: 10,
  // Days of the 7 with an arrival. One loud day is a news spike or one link.
  webDays7: 3,
  // This week against the usual week; +5 shrinks small numbers like Rising.
  lift7: 1.5,
  shrink7: 5,
  // More arrivals than 3 per person: somebody searching and reloading.
  perPerson: 3,
  // Distinct people who found it with our own search box this week.
  sitePeople7: 5,
  siteDays7: 3,
  // One of our own searches is worth this many search-engine arrivals.
  siteWeight: 3,
  // The /my-admin line says "Google" only when Google sent at least this share.
  googleShare: 0.8,
  // Days of search-arrival history before the rise rule is trusted. Under
  // this, the shelf ranks by volume (see the top of this file).
  matureDays: 28,
}

/** The two modes, and what /my-admin calls them. */
export const SEARCH_MODES = {
  volume: 'most searched (young data)',
  lift: 'rising',
}

/**
 * The mode for tonight, from how many closed days the arrivals table holds
 * (null when it holds none, which is young too).
 */
export const searchModeOf = (historyDays) =>
  (historyDays || 0) >= SEARCHING.matureDays ? 'lift' : 'volume'

const isVolume = (ctx) => ctx?.searchMode === 'volume'
// Tonight's people floors, or the fixed ones when the planner gave none.
const webFloor = (ctx) => ctx?.floors?.webPeople7 ?? SEARCHING.webPeople7
const siteFloor = (ctx) => ctx?.floors?.sitePeople7 ?? SEARCHING.sitePeople7

const MAX_REASON = 119
const cut = (text) => (text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text)
const round2 = (n) => Math.round(n * 100) / 100

/** This week's search arrivals against the usual week. */
export function searchLift(s, baseDays = 30) {
  const r30 = (s.g30 || 0) / Math.max(baseDays, 1)
  return ((s.g7 || 0) + SEARCHING.shrink7) / (7 * r30 + SEARCHING.shrink7)
}

/** Why the search-engine side does not qualify, or null. */
export function webMiss(s, ctx = {}) {
  const people = s.gPeople7 || 0
  const floor = webFloor(ctx)
  if (people < floor) return `found on search by ${people} of ${floor} people`
  if ((s.gDays7 || 0) < SEARCHING.webDays7) return `found on search on ${s.gDays7 || 0} of ${SEARCHING.webDays7} days`
  if ((s.g7 || 0) > SEARCHING.perPerson * people) return `one-visitor share: ${s.g7} arrivals from ${people} people`
  // Young data: no usual yet to rise from, so the floors above are the rule.
  if (isVolume(ctx)) return null
  const lift = searchLift(s, ctx.searchBaseDays)
  if (lift < SEARCHING.lift7) return `found ${lift.toFixed(1)}x its usual on search, needs ${SEARCHING.lift7}x`
  return null
}

/** Why the own-search side does not qualify, or null. */
export function siteMiss(s, ctx = {}) {
  const people = s.sPeople7 || 0
  const floor = siteFloor(ctx)
  if (people < floor) return `searched here by ${people} of ${floor} people`
  if ((s.sDays7 || 0) < SEARCHING.siteDays7) return `searched here on ${s.sDays7 || 0} of ${SEARCHING.siteDays7} days`
  if ((s.s7 || 0) > SEARCHING.perPerson * people) return `one-visitor share: ${s.s7} searches from ${people} people`
  return null
}

/**
 * Why a title is not on the shelf tonight, or null when it qualifies. When
 * both sides miss, the reason names the side that came closer. The brakes
 * every shelf shares (a title AniList barely knows needs 5 days; a page most
 * people leave at once is not one to send more people to) come from
 * ctx.floors, the planner's own FLOORS.
 */
export function searchingMiss(s, title, ctx = {}) {
  if (!s) return 'no numbers this week'
  const web = webMiss(s, ctx)
  const site = siteMiss(s, ctx)
  if (web && site) return (s.gPeople7 || 0) >= (s.sPeople7 || 0) * SEARCHING.siteWeight ? web : site
  const f = ctx.floors || {}
  const days = Math.max(web ? 0 : s.gDays7 || 0, site ? 0 : s.sDays7 || 0)
  if ((title?.popularity || 0) < (f.popularityAnchor || 0) && days < (f.anchorDays || 0)) {
    return `unknown on AniList and searched on ${days} of ${f.anchorDays} days`
  }
  const entries = s.entries7 || 0
  if (f.quickExitMinEntries && entries >= f.quickExitMinEntries && (s.quick7 || 0) / entries > f.quickExitShare) {
    return 'most visits leave at once'
  }
  return null
}

/**
 * Rising: search-engine people times the rise, plus our own searchers,
 * weighted. Young data: distinct people from search engines plus distinct
 * people on our own search box, each side counted only when it qualifies.
 */
export function searchingScore(s, ctx = {}) {
  if (isVolume(ctx)) {
    return (webMiss(s, ctx) ? 0 : s.gPeople7 || 0) + (siteMiss(s, ctx) ? 0 : s.sPeople7 || 0)
  }
  const web = webMiss(s, ctx) ? 0 : (s.gPeople7 || 0) * Math.min(searchLift(s, ctx.searchBaseDays), 4)
  const site = siteMiss(s, ctx) ? 0 : SEARCHING.siteWeight * (s.sPeople7 || 0)
  return round2(web + site)
}

/** The engine to name: Google when it sent most of the week, else "search". */
export const engineLabel = (s) =>
  (s.g7 || 0) > 0 && (s.gGoogle7 || 0) >= SEARCHING.googleShare * (s.g7 || 0) ? 'Google' : 'search'

/** Both numbers, always, for /my-admin: search engines and our own box. */
export function searchingReason(s, ctx = {}) {
  if (isVolume(ctx)) {
    return cut(`Found on ${engineLabel(s)} by ${s.gPeople7 || 0} people this week (${s.g7 || 0} arrivals), searched here by ${s.sPeople7 || 0}`)
  }
  const lift = searchLift(s, ctx.searchBaseDays).toFixed(1)
  return cut(
    `Found on ${engineLabel(s)} by ${s.gPeople7 || 0} people this week (${s.g7 || 0} arrivals, ${lift}x usual), searched here by ${s.sPeople7 || 0}`
  )
}

// The words on the cover (owner's call, 27 Sep 2026): no engine, no count.
export const SEARCHING_BADGE = 'Hot this week'

/**
 * The line on the cover, only while the title still qualifies on either
 * side, so a title kept by its minimum stay after the searching stopped
 * does not claim to be hot.
 */
export function searchingBadge(s, ctx = {}) {
  return !webMiss(s, ctx) || !siteMiss(s, ctx) ? SEARCHING_BADGE : ''
}

/** How close a title came, for ordering the "kept off" list. */
export const searchingStrength = (s) => (s.gPeople7 || 0) + SEARCHING.siteWeight * (s.sPeople7 || 0)

export const searchingRule = {
  miss: searchingMiss,
  score: searchingScore,
  reason: searchingReason,
  badge: searchingBadge,
  strength: searchingStrength,
}
