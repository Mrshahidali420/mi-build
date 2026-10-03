-- The name and page of every title that has star votes, so /my-admin/reviews
-- lists "Solo Leveling" instead of "AniList #151807". The Worker holds no
-- catalog to look ids up in, so the vote copies them in, as a review does.
CREATE TABLE IF NOT EXISTS rated_titles (
  anilist_id INTEGER PRIMARY KEY CHECK (anilist_id > 0),
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '');
