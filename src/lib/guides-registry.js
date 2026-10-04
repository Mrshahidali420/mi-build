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
import { groupByCategory } from './guides.mjs'

/**
 * Data guides, listed by hand. Example row:
 *   { slug: 'free-manhwa-official-apps', title: 'Manhwa You Can Read Free on Official Apps',
 *     description: '...', category: 'data', updated: '2026-10-10',
 *     image: 'https://s4.anilist.co/...', imageAlt: '...', wide: false }
 */
export const DATA_GUIDES = []

/** Written guides and data guides together. */
export const allGuides = () => [...guideIndex.guides, ...DATA_GUIDES]

/** The hub's groups, in category order. */
export const guidesByCategory = () => groupByCategory(allGuides())

/** One guide's row by slug, for "related guides" links. */
export const guideBySlug = (slug) => allGuides().find((g) => g.slug === slug) || null
