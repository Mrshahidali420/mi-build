/**
 * Every guide the site has, for the hub (/guides) and the sitemap.
 *
 * Two kinds:
 *   - Written guides: Markdown in src/content/guides/, drawn by
 *     src/pages/guides/[slug].astro. Their list comes from
 *     data/guide-index.json, which `npm run guides:media` writes, so this
 *     module needs no astro:content and stays cheap to import anywhere.
 *   - Data guides: their own .astro pages under src/pages/guides/, built from
 *     the catalog. Add one row to DATA_GUIDES when such a page ships.
 *
 * Row shape (both kinds): { slug, title, description, category, updated,
 * image, imageAlt, wide }. category is a key of GUIDE_CATEGORIES in guides.mjs.
 */
import guideIndex from '../../data/guide-index.json'
import dataBanners from '../../data/guide-data-banners.json'
import { groupByCategory } from './guides.mjs'
import { DATA_GUIDES } from './guides-data-content.js'

export { DATA_GUIDES }

/* The hand-written rows live in guides-data-content.js; see the comment up
there (image/wide is a fallback cover until npm run guides:media runs; see
withBanner below). The example row shape, so it stays visible here too:
  { slug: 'free-manhwa-official-apps', title: 'Manhwa You Can Read Free on Official Apps',
    description: '...', category: 'data', updated: '2026-10-10',
    image: 'https://s4.anilist.co/...', imageAlt: '...', wide: false } */


/**
 * A data guide's hand-written row, with its `image`/`wide` swapped for the
 * banner npm run guides:media assigned it (data/guide-data-banners.json),
 * unique against every written guide's banner too. Missing the file, or
 * that slug not in it yet, keeps the hand-picked cover as a fallback.
 */
function withBanner(guide) {
  const b = dataBanners[guide.slug]
  if (!b?.banner) return guide
  return { ...guide, image: b.banner, imageAlt: guide.title, wide: !b.isFallbackCover, isFallbackCover: !!b.isFallbackCover }
}

/** One data guide's row by slug, for the pages themselves (title, description). */
export const dataGuide = (slug) => {
  const guide = DATA_GUIDES.find((g) => g.slug === slug)
  return guide ? withBanner(guide) : guide
}

/** The written (Markdown) guides, as data/guide-index.json lists them. */
export const writtenGuides = () => guideIndex.guides

/** Written guides and data guides together. */
export const allGuides = () => [...guideIndex.guides, ...DATA_GUIDES.map(withBanner)]

/** The hub's groups, in category order. */
export const guidesByCategory = () => groupByCategory(allGuides())

/** One guide's row by slug, for "related guides" links. */
export const guideBySlug = (slug) => allGuides().find((g) => g.slug === slug) || null
