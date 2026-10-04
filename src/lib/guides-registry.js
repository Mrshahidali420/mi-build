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

// image is the fallback picture; pictures are covers of the page's top
// entries, best first, and the hub, the homepage row and "More guides" give
// each card one of them that no other card on that page shows yet
// (assignCardImages in guides.mjs). Each page
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
    pictures: [
      { src: `${COVER}/manga/cover/large/bx105398-b673Vt5ZSuz3.jpg`, alt: 'Cover of Solo Leveling' },
      { src: `${COVER}/manga/cover/large/bx119257-Pi21aq3ey9GG.jpg`, alt: 'Cover of Omniscient Reader' },
      { src: `${COVER}/manga/cover/large/bx85143-23oup3ETbFJk.jpg`, alt: 'Cover of Tower of God' },
      { src: `${COVER}/manga/cover/large/bx140407-fJQr0fmqq1IO.png`, alt: 'Cover of The Greatest Estate Developer' },
      { src: `${COVER}/manga/cover/large/bx128067-wnLBg6Cy1ncs.jpg`, alt: 'Cover of SSS-Class Revival Hunter' },
      { src: `${COVER}/manga/cover/large/bx100568-4BC0PsdwU4bL.png`, alt: 'Cover of The Horizon' },
      { src: `${COVER}/manga/cover/large/bx126297-SPiM7QtUnJ4P.jpg`, alt: 'Cover of Teenage Mercenary' },
      { src: `${COVER}/manga/cover/large/bx100954-xY0Vw2sRRo8t.png`, alt: 'Cover of Sweet Home' },
    ],
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
    pictures: [
      { src: `${COVER}/anime/cover/large/bx195516-MJpUZlOberqH.jpg`, alt: 'Cover of The Apothecary Diaries Season 3' },
      { src: `${COVER}/anime/cover/large/bx195539-jaarfaxv6K0Z.jpg`, alt: 'Cover of Cyberpunk: Edgerunners 2' },
      { src: `${COVER}/anime/cover/large/bx195604-8xUI10lVVhPY.jpg`, alt: 'Cover of Black Clover Season 2' },
      { src: `${COVER}/anime/cover/large/bx159042-GGFwlDskc5vR.png`, alt: 'Cover of Reincarnated as a Sword Season 2' },
      { src: `${COVER}/anime/cover/large/bx189123-0secXELIhkIW.jpg`, alt: 'Cover of Blue Box Season 2' },
      { src: `${COVER}/anime/cover/large/bx178083-bg7pg6TCHwtG.jpg`, alt: 'Cover of Tokyo Revengers: Santen Sensou-hen' },
    ],
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
    pictures: [
      { src: `${COVER}/manga/cover/large/bx105778-euxXZEIfDY2u.png`, alt: 'Cover of Chainsaw Man' },
      { src: `${COVER}/manga/cover/large/bx101517-H3TdM3g5ZUe9.jpg`, alt: 'Cover of Jujutsu Kaisen' },
      { src: `${COVER}/manga/cover/large/bx30013-BeslEMqiPhlk.jpg`, alt: 'Cover of One Piece' },
      { src: `${COVER}/manga/cover/large/bx53390-1RsuABC34P9D.jpg`, alt: 'Cover of Attack on Titan' },
      { src: `${COVER}/manga/cover/large/bx87216-c9bSNVD10UuD.png`, alt: 'Cover of Demon Slayer: Kimetsu no Yaiba' },
      { src: `${COVER}/manga/cover/large/bx108556-NHjkz0BNJhLx.jpg`, alt: 'Cover of SPY x FAMILY' },
      { src: `${COVER}/manga/cover/large/bx30002-Cul4OeN7bYtn.jpg`, alt: 'Cover of Berserk' },
      { src: `${COVER}/manga/cover/large/bx105398-b673Vt5ZSuz3.jpg`, alt: 'Cover of Solo Leveling' },
    ],
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
    pictures: [
      { src: `${COVER}/manga/cover/large/bx105398-b673Vt5ZSuz3.jpg`, alt: 'Cover of Solo Leveling' },
      { src: `${COVER}/manga/cover/large/bx119257-Pi21aq3ey9GG.jpg`, alt: 'Cover of Omniscient Reader' },
      { src: `${COVER}/manga/cover/large/bx85143-23oup3ETbFJk.jpg`, alt: 'Cover of Tower of God' },
      { src: `${COVER}/manga/cover/large/bx140407-fJQr0fmqq1IO.png`, alt: 'Cover of The Greatest Estate Developer' },
      { src: `${COVER}/manga/cover/large/bx128067-wnLBg6Cy1ncs.jpg`, alt: 'Cover of SSS-Class Revival Hunter' },
      { src: `${COVER}/manga/cover/large/bx100568-4BC0PsdwU4bL.png`, alt: 'Cover of The Horizon' },
      { src: `${COVER}/manga/cover/large/bx126297-SPiM7QtUnJ4P.jpg`, alt: 'Cover of Teenage Mercenary' },
      { src: `${COVER}/manga/cover/large/bx100954-xY0Vw2sRRo8t.png`, alt: 'Cover of Sweet Home' },
      { src: `${COVER}/manga/cover/large/bx85141-qHR957V3FVco.png`, alt: 'Cover of The God of High School' },
    ],
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
    pictures: [
      { src: `${COVER}/manga/cover/large/bx121565-JaDVhpjegXvw.jpg`, alt: 'Cover of Seasons of Blossom' },
      { src: `${COVER}/manga/cover/large/bx187944-gzNbL7zeY7Ma.jpg`, alt: 'Cover of My Bias Gets on the Last Train' },
      { src: `${COVER}/manga/cover/large/bx118408-zZuOINqjBZYn.jpg`, alt: 'Cover of Villains Are Destined to Die' },
      { src: `${COVER}/manga/cover/large/bx107521-M4x3AUb7UGIM.png`, alt: 'Cover of Who Made Me a Princess' },
      { src: `${COVER}/manga/cover/large/bx104677-p6TjXRd1gsDY.jpg`, alt: 'Cover of Her Tale of Shim Chong' },
      { src: `${COVER}/manga/cover/large/bx130429-m3PuqOmxBgoo.png`, alt: 'Cover of I Shall Master this Family!' },
    ],
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
    pictures: [
      { src: `${COVER}/manga/cover/large/bx119257-Pi21aq3ey9GG.jpg`, alt: 'Cover of Omniscient Reader' },
      { src: `${COVER}/manga/cover/large/bx119521-qYqxFvn0NnXo.png`, alt: 'Cover of The Legend of the Northern Blade' },
      { src: `${COVER}/manga/cover/large/bx106929-flAUvHZDUz5v.jpg`, alt: 'Cover of Eleceed' },
      { src: `${COVER}/manga/cover/large/bx177706-3r8dnAr8Prjq.jpg`, alt: 'Cover of The Knight Only Lives Today' },
      { src: `${COVER}/manga/cover/large/bx132144-i5B4VnG9sRgh.png`, alt: 'Cover of Return of the Blossoming Blade' },
      { src: `${COVER}/manga/cover/large/bx159441-9W8201jAT9Yv.jpg`, alt: 'Cover of Pick Me Up' },
      { src: `${COVER}/manga/cover/large/bx175946-rx6eIfakvWYV.jpg`, alt: 'Cover of Myst, Might, Mayhem' },
    ],
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
    pictures: [
      { src: `${COVER}/manga/cover/large/bx140407-fJQr0fmqq1IO.png`, alt: 'Cover of The Greatest Estate Developer' },
      { src: `${COVER}/manga/cover/large/bx119257-Pi21aq3ey9GG.jpg`, alt: 'Cover of Omniscient Reader' },
      { src: `${COVER}/manga/cover/large/bx119521-qYqxFvn0NnXo.png`, alt: 'Cover of The Legend of the Northern Blade' },
      { src: `${COVER}/manga/cover/large/bx177706-3r8dnAr8Prjq.jpg`, alt: 'Cover of The Knight Only Lives Today' },
      { src: `${COVER}/manga/cover/large/bx132144-i5B4VnG9sRgh.png`, alt: 'Cover of Return of the Blossoming Blade' },
      { src: `${COVER}/manga/cover/large/bx159441-9W8201jAT9Yv.jpg`, alt: 'Cover of Pick Me Up' },
      { src: `${COVER}/manga/cover/large/bx128067-wnLBg6Cy1ncs.jpg`, alt: 'Cover of SSS-Class Revival Hunter' },
    ],
  },
]

/** One data guide's row by slug, for the pages themselves (title, description). */
export const dataGuide = (slug) => DATA_GUIDES.find((g) => g.slug === slug)

/** The written (Markdown) guides, as data/guide-index.json lists them. */
export const writtenGuides = () => guideIndex.guides

/** Written guides and data guides together. */
export const allGuides = () => [...guideIndex.guides, ...DATA_GUIDES]

/** The hub's groups, in category order. */
export const guidesByCategory = () => groupByCategory(allGuides())

/** One guide's row by slug, for "related guides" links. */
export const guideBySlug = (slug) => allGuides().find((g) => g.slug === slug) || null
