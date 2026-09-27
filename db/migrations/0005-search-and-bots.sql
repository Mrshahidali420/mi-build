-- 0005: search-engine arrivals per page, and the door's refused hits.
--
-- Run ONCE, by hand, BEFORE the Worker that writes these is deployed:
--   npx wrangler d1 execute manhwaindex-analytics --remote --file db/migrations/0005-search-and-bots.sql
-- If the Worker ships first, the night job's batch names a table that does
-- not exist, the whole batch fails, and that night is not rolled up (it heals
-- itself the next night once this has run). The door counter just loses its
-- counts until then; it never breaks a beacon.
--
-- Safe to run twice: the tables are IF NOT EXISTS and the backfill is
-- INSERT OR IGNORE. Nothing here deletes or rewrites a row that holds numbers.

-- Page views that arrived from a search engine, per page and engine, per day.
-- The "People are searching for" shelf reads it (scripts/plan-home.mjs), and
-- so does the Search tab. Top 300 a day, like daily_pages. See
-- src/lib/search-signals.js for which hosts count as which engine.
CREATE TABLE IF NOT EXISTS daily_search_arrivals (
  day TEXT, path TEXT, engine TEXT, views INTEGER DEFAULT 0, people INTEGER DEFAULT 0,
  PRIMARY KEY (day, path, engine));

-- Hits the beacon and the pass desk refused (and let in), by reason, per day.
-- Counts only: no address, no visitor id, no page, just the country code the
-- events table already keeps. Written in batches by each Worker isolate, at
-- most once a minute (src/lib/reject-count.js). WITHOUT ROWID so an upsert is
-- one written row, not a row plus an index entry.
CREATE TABLE IF NOT EXISTS daily_rejects (
  day TEXT NOT NULL, reason TEXT NOT NULL, place TEXT NOT NULL, country TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, reason, place, country)) WITHOUT ROWID;

-- The raw rows are kept 30 days, so every day the night job has already
-- closed can be filled in now; without this the shelf would have no "usual"
-- to rise from for weeks. The same question the night job asks
-- (arrivalsRollupSql in src/lib/search-signals.js), for all closed days at
-- once, with the same top 300 per day.
INSERT OR IGNORE INTO daily_search_arrivals (day, path, engine, views, people)
SELECT day, path, engine, views, people FROM (
  SELECT day, path, engine, COUNT(*) AS views,
    COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END) AS people,
    ROW_NUMBER() OVER (PARTITION BY day ORDER BY COUNT(*) DESC) AS place
  FROM (SELECT day, path, visitor,
          (CASE WHEN referrer LIKE 'google.%' OR referrer LIKE 'www.google.%' OR referrer LIKE 'com.google.android.googlequicksearchbox' THEN 'google' WHEN referrer LIKE 'bing.com' OR referrer LIKE '%.bing.com' THEN 'bing' WHEN referrer LIKE 'yandex.%' OR referrer LIKE '%.yandex.%' OR referrer LIKE 'ya.ru' THEN 'yandex' WHEN referrer LIKE 'duckduckgo.com' OR referrer LIKE '%.duckduckgo.com' THEN 'duckduckgo' WHEN referrer LIKE 'search.yahoo.com' OR referrer LIKE '%.search.yahoo.com' THEN 'yahoo' WHEN referrer LIKE 'ecosia.org' OR referrer LIKE '%.ecosia.org' THEN 'ecosia' WHEN referrer LIKE 'search.brave.com' THEN 'brave' WHEN referrer LIKE 'baidu.com' OR referrer LIKE '%.baidu.com' THEN 'baidu' WHEN referrer LIKE 'search.naver.com' OR referrer LIKE '%.search.naver.com' THEN 'naver' WHEN referrer LIKE 'qwant.com' OR referrer LIKE '%.qwant.com' THEN 'qwant' ELSE '' END) AS engine
        FROM events
        WHERE day IN (SELECT day FROM rollup_log) AND kind = 'view' AND referrer <> '' AND path <> '')
  WHERE engine <> ''
  GROUP BY day, path, engine)
WHERE place <= 300;
