// A small made-up catalog for the template post types (social-types.test.js,
// social-render.test.js): enough records for every type to find a post.
import { buildData } from '../scripts/social/source.mjs'
import { dateOf } from '../scripts/social/when.mjs'
import { NOW, record } from './social-kit.mjs'

const COVER = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large'
const FACE = 'https://s4.anilist.co/file/anilistcdn/character/large'

const cast = (id, name, role = 'MAIN') => ({ id, name, image: `${FACE}/b${id}-x.png`, role })

/** A finished, popular manhwa with all-time ranks, a cast, an anime and three recommendations. */
export const classic = (over = {}) =>
  record({
    ranks: [{ rank: 7, type: 'RATED', allTime: true }, { rank: 3, type: 'RATED', allTime: false, year: 2018 }, { rank: 12, type: 'POPULAR', allTime: true }],
    characters: [cast(901, 'Sung Jinwoo'), cast(902, 'Cha Haein'), cast(903, 'Extra', 'SUPPORTING'), { ...cast(904, 'No Face'), image: `${FACE}/default.jpg` }],
    animeInIndex: [{ title: 'Solo Leveling', episodes: 12 }],
    recIds: [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }],
    ...over,
  })

/** A manhwa still coming out: number n of a shelf of action series. */
export const running = (n, over = {}) =>
  record({
    id: 10 + n,
    slug: `gate-${n}`,
    title: `Gate Runner ${n}`,
    status: 'RELEASING',
    endYear: null,
    chapters: null,
    score: 70 + n,
    popularity: 90000 - n * 10000,
    startYear: 2023,
    cover: `${COVER}/bx${10 + n}-a.jpg`,
    ...over,
  })

export function sampleItems() {
  return [
    classic(),
    ...Array.from({ length: 5 }, (_, n) => running(n)),
    // Started five weeks ago, known to the day; and one known only to the year.
    running(6, { id: 30, slug: 'fresh-ink', title: 'Fresh Ink', popularity: 800, score: null, genres: ['Romance', 'Drama'], startYear: 2026, startDate: [2026, 9, 5], startPrecision: 'day' }),
    running(7, { id: 31, slug: 'some-year', title: 'Some Year', popularity: 700, startYear: 2026, startDate: [2026, 1, 1], startPrecision: 'year' }),
    // A Japanese manga counted in volumes, with a high score.
    record({ id: 40, slug: 'paper-sky', title: 'Paper Sky', country: 'JP', chapters: null, volumes: 14, score: 91, popularity: 60000, startYear: 2012, endYear: 2019, cover: `${COVER}/bx40-a.jpg`, readLinks: [{ site: 'VIZ', url: 'https://viz.com/x', language: 'English' }] }),
    // Left out everywhere a large cover is needed.
    record({ id: 50, slug: 'old-scan', title: 'Old Scan', popularity: 50000, cover: 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/50.jpg' }),
  ]
}

/** The data the types read, built the way the poster builds it. */
export function sampleData(now = NOW) {
  const data = buildData(sampleItems(), now)
  return { ...data, birthdays: sampleBirthdays(now), art: sampleArt(data.byId.get(sampleItems()[0].id)) }
}

/** Pictures as art/load.mjs hands them over: one fan art and one cosplay of the first title. */
export function sampleArt(title) {
  const picture = (n, over = {}) => ({ source: 'danbooru', id: `danbooru:${n}`, hash: `h${n}`, image: `https://cdn.donmai.us/original/${n}.jpg`, rating: 'g', ecchi: false, tags: ['1girl'], characters: ['mira_vale'], series: [], artist: 'Artist One', credit: { name: 'Artist One', url: `https://x.com/a/${n}` }, title, character: 'Mira Vale', ...over })
  return { fanart: [picture(1)], cosplay: [picture(2, { character: null })] }
}


/** Today's birthdays as birthdays.mjs hands them over: one character of the first comic of the sample. */
export const sampleBirthdays = (now = NOW) => ({ day: dateOf(now), list: [{ id: 901, name: 'Mira Vale', image: 'https://s4.anilist.co/file/anilistcdn/character/large/b901-x.png', favourites: 5000, mediaId: sampleItems()[0].id, voice: null }] })

/** Loaded art in the shape a template is handed (no real picture needed to build the tree). */
export const fakeArt = (post) => ({
  hero: post.art?.hero ? { src: 'data:image/jpeg;base64,AA==', ratio: 0.71 } : null,
  thumbs: (post.art?.thumbs || []).map(() => ({ src: 'data:image/jpeg;base64,AA==', ratio: 0.71 })),
})

/** Every piece of text and every picture in a template tree. */
export function walk(node, found = { texts: [], images: [] }) {
  if (node === null || node === undefined || node === false) return found
  if (typeof node === 'string' || typeof node === 'number') {
    found.texts.push(String(node))
    return found
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, found)
    return found
  }
  if (node.type === 'img') found.images.push(node.props)
  walk(node.props?.children, found)
  return found
}
