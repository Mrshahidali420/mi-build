/**
 * "New this season": a homepage shelf that turns up on its own when an anime
 * season starts and leaves six weeks later.
 *
 * A season start is the one time many readers come looking for "what is new
 * this season". The homepage is built every night, so the shelf needs no
 * switch: the build date decides whether it is drawn. The titles are the
 * season's own anime from the catalog (AniList's season and year, the same
 * fields the season hub pages use), most popular first, so the shelf and the
 * hub at /anime/season/<year>/<season> always agree.
 *
 * Pure: the catalog, the date and the page's own list in, a shelf or null out.
 */
import { currentSeason, seasonLabel, seasonPath, SEASON_ORDER } from './season-core.mjs'

export const SEASON_SHELF_DAYS = 42
export const SEASON_SHELF_SIZE = 18
// Fewer than this and the shelf would look empty next to the others.
export const SEASON_SHELF_MIN = 6

/** The first day of a season, UTC: 1 Jan, 1 Apr, 1 Jul or 1 Oct. */
export function seasonStartDay(year, season) {
  const month = SEASON_ORDER.indexOf(String(season || '').toUpperCase()) * 3
  return new Date(Date.UTC(year, Math.max(month, 0), 1))
}

/**
 * The shelf, or null when today is not in the first six weeks of a season,
 * or when too few of the season's titles are left after the rest of the
 * homepage took its covers. `keep(item)` is the homepage's own safety check
 * (the adult filter the auto shelves use).
 */
export function newSeasonShelf(anime, { now = new Date(), onPage = new Set(), keep = () => true } = {}) {
  const { year, season } = currentSeason(now)
  const start = seasonStartDay(year, season)
  const age = Math.floor((now.getTime() - start.getTime()) / 86400000)
  if (age < 0 || age >= SEASON_SHELF_DAYS) return null
  const items = anime
    .filter((a) => a.seasonYear === year && String(a.season || '').toUpperCase() === season)
    .filter((a) => a.cover && !onPage.has(a.id) && keep(a))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || a.id - b.id)
    .slice(0, SEASON_SHELF_SIZE)
  if (items.length < SEASON_SHELF_MIN) return null
  const label = `${seasonLabel(season)} ${year}`
  return {
    key: 'season',
    title: `New this season: ${label}`,
    // AniList files a show under its season before its first episode, so the
    // line says "listed for", never "started airing".
    why: `The anime AniList lists for ${label}, most followed first.`,
    href: seasonPath(year, season),
    items,
  }
}
