-- 0004: what the self-updating homepage needs from the night job.
--
-- Run ONCE, by hand, BEFORE the Worker that writes these is deployed:
--   npx wrangler d1 execute manhwaindex-analytics --remote --file db/migrations/0004-home.sql
-- If the Worker ships first, the night job's batch names a table and a column
-- that do not exist, the whole batch fails, and that night is not rolled up
-- (it heals itself the next night once this has run).
--
-- ADD COLUMN cannot be run twice: a second run stops at that line with
-- "duplicate column name" and changes nothing. That error means it already ran.
-- Nothing here deletes or rewrites a row that holds numbers.

-- Pages opened straight from the homepage (the view's prev was '/'), per day.
-- This is how a homepage section is measured before the page sends its own
-- section clicks: a title that sits on the homepage and is never opened from
-- it is not earning its slot. Top 300 a day, like daily_pages.
CREATE TABLE IF NOT EXISTS daily_from_home (
  day TEXT, path TEXT, views INTEGER DEFAULT 0, people INTEGER DEFAULT 0,
  PRIMARY KEY (day, path));

-- The first night a page ever had a rollup row, so "new and noticed" can tell
-- a new title from an old one that is having a good week.
ALTER TABLE total_pages ADD COLUMN first_day TEXT;

-- Pages already counted get the oldest day the daily table still holds for
-- them. Without this every existing page would look brand new the next night.
UPDATE total_pages SET first_day = (
  SELECT MIN(day) FROM daily_pages WHERE daily_pages.path = total_pages.path)
WHERE first_day IS NULL;
