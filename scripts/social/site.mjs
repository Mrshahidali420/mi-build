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

/** The repo variable that adds the Amazon line to the first comment. Off unless it is exactly 'true'. */
export const affiliateOn = (env) => env.FB_AFFILIATE_COMMENT === 'true'

/**
 * The first comment. Line 1 is always the site link, so the preview card is
 * the site's. Line 2 is the Amazon link of this very title, only when the
 * switch is on and the site's own picks hold a product for it (shop.mjs).
 * Nothing else is said about it here (the disclosure lives on the site).
 * @param post { label, path, shop? }
 */
export function commentFor(post, { affiliate = false } = {}) {
  const lines = [`${post.label}: ${linkOf(post.path)}`]
  if (affiliate && post.shop?.url) lines.push(`${post.shop.label}: ${post.shop.url}`)
  return lines.join('\n')
}

/** The first comment of a classic post. */
export function commentOf(candidate, options) {
  const label = candidate.verb === 'watch' ? 'Where to watch it' : 'Where to read it'
  return commentFor({ label, path: candidate.path, shop: candidate.shop }, options)
}
