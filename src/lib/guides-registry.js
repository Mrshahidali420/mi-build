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
const COVER = 'https://s4.anilist.co/file/anilistcdn/media'

// The image here is the hub tile and the "More guides" picture. Each page
// draws its own hero from the catalog at build time (the top entry's cover),
// so a tile can lag a page by a build; it is never a broken link.
// updated is the day the page's text last changed; the numbers on the page
// carry their own "Updated" date from the build.
export const DATA_GUIDES = [
  {
    slug: 'free-manhwa-official-apps',
    title: 'Manhwa You Can Read Free on Official Apps',
    description:
      'The 50 most popular manhwa you can start reading free on official apps like WEBTOON, Tapas and KakaoPage, with the free platforms named for every title.',
    category: 'data',
    updated: '2026-10-04',
    image: `${COVER}/manga/cover/large/bx105398-b673Vt5ZSuz3.jpg`,
    imageAlt: 'Solo Leveling cover',
    wide: false,
  },
  {
    slug: 'where-to-watch-this-season-anime',
    title: "Where to Watch This Season's Anime Legally",
    description:
      "Every anime airing this season with a legal stream, most popular first, and the official services carrying each one, from Crunchyroll to Netflix and HIDIVE.",
    category: 'data',
    updated: '2026-10-04',
    image: `${COVER}/anime/cover/large/bx195516-MJpUZlOberqH.jpg`,
    imageAlt: 'The Apothecary Diaries Season 3 cover',
    wide: false,
  },
  {
    slug: 'platforms-with-most-licensed-manga',
    title: 'Which Platform Has the Most Licensed Manga, Manhwa and Manhua',
    description:
      'Official reading platforms ranked by how many manga, manhwa and manhua they carry, counted from our own records, with what each one costs and its biggest titles.',
    category: 'data',
    updated: '2026-10-04',
    image: `${COVER}/manga/cover/large/bx105778-euxXZEIfDY2u.png`,
    imageAlt: 'Chainsaw Man cover',
    wide: false,
  },
  {
    slug: 'manhwa-official-english-release',
    title: 'Manhwa With an Official English Release',
    description:
      'How many manhwa have an official English release, how many are Korean-only, and the 50 most popular manhwa you can read in English on licensed platforms.',
    category: 'data',
    updated: '2026-10-04',
    image: `${COVER}/manga/banner/105398-4UrEhdqZukrg.jpg`,
    imageAlt: 'Solo Leveling banner',
    wide: true,
  },
  {
    slug: 'best-romance-manhwa',
    title: 'Best Romance Manhwa on Official Platforms',
    description:
      'The 30 best romance manhwa you can read on official platforms, ranked by reader score among the most popular in the genre, with where to read each one legally.',
    category: 'recommendations',
    updated: '2026-10-04',
    image: `${COVER}/manga/cover/large/bx121565-JaDVhpjegXvw.jpg`,
    imageAlt: 'Seasons of Blossom cover',
    wide: false,
  },
  {
    slug: 'best-action-manhwa',
    title: 'Best Action Manhwa on Official Platforms',
    description:
      'The 30 best action manhwa you can read on official platforms, ranked by reader score among the most popular in the genre, with where to read each one legally.',
    category: 'recommendations',
    updated: '2026-10-04',
    image: `${COVER}/manga/cover/large/bx119257-Pi21aq3ey9GG.jpg`,
    imageAlt: 'Omniscient Reader cover',
    wide: false,
  },
  {
    slug: 'best-fantasy-manhwa',
    title: 'Best Fantasy Manhwa on Official Platforms',
    description:
      'The 30 best fantasy manhwa you can read on official platforms, ranked by reader score among the most popular in the genre, with where to read each one legally.',
    category: 'recommendations',
    updated: '2026-10-04',
    image: `${COVER}/manga/cover/large/bx140407-fJQr0fmqq1IO.png`,
    imageAlt: 'The Greatest Estate Developer cover',
    wide: false,
  },
]

/** One data guide's row by slug, for the pages themselves (title, description). */
export const dataGuide = (slug) => DATA_GUIDES.find((g) => g.slug === slug)

/** Written guides and data guides together. */
export const allGuides = () => [...guideIndex.guides, ...DATA_GUIDES]

/** The hub's groups, in category order. */
export const guidesByCategory = () => groupByCategory(allGuides())

/** One guide's row by slug, for "related guides" links. */
export const guideBySlug = (slug) => allGuides().find((g) => g.slug === slug) || null
