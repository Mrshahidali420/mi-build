/**
 * A character record ingested before scripts/anilist-core.mjs learned to
 * carry a novel title's own kind (see kindOfMedia in anilist-core.mjs) keeps
 * an old appearance row stuck at kind 'comic' for a title that is really a
 * novel. sectionOf (src/lib/platform-aliases.mjs... see section.mjs) reads
 * that kind to build the title's URL, so the row linked /manga/<slug> or
 * /manhwa/<slug> or /manhua/<slug> for a page that only exists at
 * /novel/<slug>: a dead link straight off the character's own page.
 *
 * The ingest never refetches an unchanged AniList record (it probes
 * updatedAt; see scripts/ingest-daily.mjs), so a fix only in the ingest
 * itself never reaches those old rows. Applying it here, on every build,
 * reaches them without a refetch. Same pattern as migrateAliasedLinks in
 * src/lib/platform-aliases.mjs.
 *
 * Pure: returns a new character object when a row changes, the same
 * `character` reference otherwise, so a caller can tell whether a record was
 * touched.
 */
export function fixNovelAppearanceKind(character, novelSlugs) {
  const rows = character.appearsIn
  if (!rows || !rows.length) return character

  let changed = false
  const fixed = rows.map((row) => {
    if (row.kind === 'comic' && novelSlugs.has(row.slug)) {
      changed = true
      return { ...row, kind: 'novel' }
    }
    return row
  })
  if (!changed) return character

  return { ...character, appearsIn: fixed }
}

/** Runs fixNovelAppearanceKind over every record in place (mutates the array). */
export function fixNovelAppearanceKindsAll(characters, novelSlugs) {
  for (let i = 0; i < characters.length; i++) {
    characters[i] = fixNovelAppearanceKind(characters[i], novelSlugs)
  }
  return characters
}
