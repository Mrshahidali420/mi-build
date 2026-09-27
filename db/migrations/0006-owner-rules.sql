-- 0006: the owner's buttons on /my-admin.
--
-- Run ONCE, by hand, BEFORE the Worker that writes these is deployed:
--   npx wrangler d1 execute manhwaindex-analytics --remote --file db/migrations/0006-owner-rules.sql
-- If the Worker ships first, a tap on a button answers "not saved" until this
-- has run, and the night planner skips its run (it keeps the last good plan)
-- because it cannot read the owner's rules.
--
-- Safe to run twice: every table is IF NOT EXISTS. Additive only; nothing
-- here touches a table that holds numbers.

-- Homepage rules set from the Homepage tab, read by scripts/plan-home.mjs and
-- merged with data/home-rules.json (both keep working). One rule per title:
-- tapping "Keep" on a hidden title replaces the hide, because the latest tap
-- is what the owner means. section is '' for a ban (every shelf) and a
-- shelf key for a pin. note is the title's name as the tab showed it, so the
-- rules list reads as names without a catalog in the Worker.
CREATE TABLE IF NOT EXISTS home_rules (
  anilist_id INTEGER PRIMARY KEY CHECK (anilist_id > 0),
  action TEXT NOT NULL CHECK (action IN ('ban', 'pin')),
  section TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL);

-- AniList ids the daily refresh must fetch, set from the Search tab. Read by
-- scripts/ingest-daily.mjs alongside data/keep.json (media only).
CREATE TABLE IF NOT EXISTS keep_media (
  anilist_id INTEGER PRIMARY KEY CHECK (anilist_id > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL);

-- Every button tap that changed something, so a surprise on the homepage can
-- be traced to the tap behind it. No address, no cookie, no secret: what was
-- done, to which id, and when.
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  anilist_id INTEGER,
  section TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '');
