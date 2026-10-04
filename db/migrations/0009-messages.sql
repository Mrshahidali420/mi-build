-- 0009: messages readers send from /feedback, /contact and /advertise.
--
-- Run ONCE, by hand, BEFORE the Worker that writes these is deployed:
--   npx wrangler d1 execute manhwaindex-analytics --remote --file db/migrations/0009-messages.sql
-- If the Worker ships first, nothing breaks: a form answers "not saved" and
-- /my-admin/messages shows an empty list until this has run.
--
-- Safe to run twice: the table and indexes are IF NOT EXISTS. Additive only.
--
-- No IP address is ever stored. `sender` is a keyed one-way hash (HMAC with
-- the Worker secret PASS_KEY) of the address and the day. It exists only for
-- the daily limit, and the night job blanks it once it is two days old
-- (src/lib/messages-api.js, forgetMessageSenders).
--
-- Every text field is plain text that passed checkMessage in
-- src/lib/messages.mjs. It is escaped wherever it is drawn; never set:html.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('feedback', 'contact', 'sponsor')),
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  day TEXT NOT NULL,
  sender TEXT,
  created_at TEXT NOT NULL);

-- The admin tab asks "everything new, newest first" and counts it for the
-- tab badge and the pause.
CREATE INDEX IF NOT EXISTS messages_status ON messages(status, created_at DESC);
-- The daily limit and the night job find a day's hashes without a full walk.
CREATE INDEX IF NOT EXISTS messages_day ON messages(day) WHERE sender IS NOT NULL;
