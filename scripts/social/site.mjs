/**
 * Manhwa Index's side of the Facebook Page poster: the brand, the address and
 * the wording of the link comment. Everything else in scripts/social/ is the
 * same module whereanime.com (where-build) carries.
 */

export const SITE = {
  key: 'manhwaindex',
  name: 'Manhwa Index',
  origin: 'https://manhwaindex.com',
}

/** Read by Base.astro's beacon (utm_* -> campaign) and by GA4 as-is. */
export const UTM = 'utm_source=facebook&utm_medium=social&utm_campaign=page'

export const linkOf = (path) => `${SITE.origin}${path}?${UTM}`

/** The first comment: one plain line and the link. */
export function commentOf(candidate) {
  const label = candidate.verb === 'watch' ? 'Where to watch it' : 'Where to read it'
  return `${label}: ${linkOf(candidate.path)}`
}
