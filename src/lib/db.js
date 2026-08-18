/* Data layer with two drivers:
   - DATABASE_URL set  → Postgres (Railway / any managed PG)
   - otherwise         → SQLite via better-sqlite3 (local dev, plain VPS)
   All exports are async so call sites don't care which driver is live. */

const PG_URL = process.env.DATABASE_URL;

const SCHEMA_SQLITE = `
  CREATE TABLE IF NOT EXISTS votes (
    slug TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS waitlist (
    email TEXT PRIMARY KEY,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sponsor_slots (
    id TEXT PRIMARY KEY,
    price_cents INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sponsor_purchases (
    id TEXT PRIMARY KEY,
    slot_id TEXT NOT NULL,
    status TEXT NOT NULL,
    stripe_session_id TEXT UNIQUE,
    stripe_payment_intent TEXT,
    amount_cents INTEGER,
    email TEXT,
    details_token TEXT UNIQUE,
    name TEXT,
    tagline TEXT,
    url TEXT,
    logo_url TEXT,
    tint TEXT,
    created_at INTEGER NOT NULL,
    hold_expires_at INTEGER,
    paid_at INTEGER,
    submitted_at INTEGER,
    approved_at INTEGER,
    starts_at INTEGER,
    ends_at INTEGER,
    reminder_details_at INTEGER,
    reminder_renew_at INTEGER,
    months INTEGER
  );
  CREATE INDEX IF NOT EXISTS sponsor_purchases_status ON sponsor_purchases (status);
  CREATE TABLE IF NOT EXISTS sponsor_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id TEXT NOT NULL,
    surface TEXT,
    country TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sponsor_clicks_slot ON sponsor_clicks (slot_id, created_at);
  CREATE TABLE IF NOT EXISTS sponsor_impressions (
    slot_id TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (slot_id, day)
  );
  CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    country TEXT,
    created_at INTEGER NOT NULL
  );

  /* Better Auth tables, exactly as \`npx auth generate\` emits them for the
     kysely/sqlite adapter (camelCase quoted columns are the adapter's own
     naming, do not snake_case them). Plus our stack table. */
  CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" INTEGER NOT NULL,
    "image" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "newsletter" INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATE NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
  CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATE,
    "refreshTokenExpiresAt" DATE,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
  CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
  CREATE TABLE IF NOT EXISTS "rateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL UNIQUE,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stack (
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    app_slug TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, app_slug)
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    app_name TEXT NOT NULL,
    app_url TEXT NOT NULL,
    take TEXT,
    submitter TEXT,
    user_id TEXT,
    status TEXT NOT NULL,
    pr_url TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS submissions_slug ON submissions (slug, status);

  /* Community builds: runtime state only, app/verdict content stays JSON in
     the repo. Builds land as status 'pending' and go live on admin approval.
     goes = the self-declared "how many goes?" answer (one|few|weeks|never);
     prompt is required for one/few, story for weeks, where_broke always.
     by_owner = repo owner matched the poster's GitHub login at submit time. */
  CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    app_slug TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    one_liner TEXT NOT NULL,
    goes TEXT NOT NULL,
    prompt TEXT,
    story TEXT,
    where_broke TEXT NOT NULL,
    tool TEXT NOT NULL,
    model TEXT,
    model_norm TEXT,
    demo_url TEXT,
    repo_url TEXT,
    chat_url TEXT,
    media TEXT NOT NULL DEFAULT '[]',
    affiliation TEXT,
    by_owner INTEGER NOT NULL DEFAULT 0,
    featured INTEGER NOT NULL DEFAULT 0,
    featured_note TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS builds_app ON builds (app_slug, status);
  CREATE INDEX IF NOT EXISTS builds_user ON builds (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS builds_user_slug ON builds (user_id, slug);
  CREATE TABLE IF NOT EXISTS build_media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    build_id TEXT,
    created_at INTEGER NOT NULL
  );
`;

const SCHEMA_PG = `
  CREATE TABLE IF NOT EXISTS votes (
    slug TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS waitlist (
    email TEXT PRIMARY KEY,
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sponsors (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sponsor_slots (
    id TEXT PRIMARY KEY,
    price_cents INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sponsor_purchases (
    id TEXT PRIMARY KEY,
    slot_id TEXT NOT NULL,
    status TEXT NOT NULL,
    stripe_session_id TEXT UNIQUE,
    stripe_payment_intent TEXT,
    amount_cents INTEGER,
    email TEXT,
    details_token TEXT UNIQUE,
    name TEXT,
    tagline TEXT,
    url TEXT,
    logo_url TEXT,
    tint TEXT,
    created_at BIGINT NOT NULL,
    hold_expires_at BIGINT,
    paid_at BIGINT,
    submitted_at BIGINT,
    approved_at BIGINT,
    starts_at BIGINT,
    ends_at BIGINT,
    reminder_details_at BIGINT,
    reminder_renew_at BIGINT,
    months INTEGER
  );
  CREATE INDEX IF NOT EXISTS sponsor_purchases_status ON sponsor_purchases (status);
  CREATE TABLE IF NOT EXISTS sponsor_clicks (
    id SERIAL PRIMARY KEY,
    slot_id TEXT NOT NULL,
    surface TEXT,
    country TEXT,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sponsor_clicks_slot ON sponsor_clicks (slot_id, created_at);
  CREATE TABLE IF NOT EXISTS sponsor_impressions (
    slot_id TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (slot_id, day)
  );
  CREATE TABLE IF NOT EXISTS searches (
    id SERIAL PRIMARY KEY,
    query TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    country TEXT,
    created_at BIGINT NOT NULL
  );

  /* Better Auth tables (kysely/postgres dialect: text / boolean / timestamptz,
     camelCase quoted columns are the adapter's own naming, do not snake_case
     them). Plus our stack table. */
  CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "newsletter" BOOLEAN NOT NULL
  );
  CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
  CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
  CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
  CREATE TABLE IF NOT EXISTS "rateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL UNIQUE,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stack (
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    app_slug TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, app_slug)
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    app_name TEXT NOT NULL,
    app_url TEXT NOT NULL,
    take TEXT,
    submitter TEXT,
    user_id TEXT,
    status TEXT NOT NULL,
    pr_url TEXT,
    error TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS submissions_slug ON submissions (slug, status);

  /* Community builds (same notes as the SQLite schema). */
  CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    app_slug TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    one_liner TEXT NOT NULL,
    goes TEXT NOT NULL,
    prompt TEXT,
    story TEXT,
    where_broke TEXT NOT NULL,
    tool TEXT NOT NULL,
    model TEXT,
    model_norm TEXT,
    demo_url TEXT,
    repo_url TEXT,
    chat_url TEXT,
    media TEXT NOT NULL DEFAULT '[]',
    affiliation TEXT,
    by_owner INTEGER NOT NULL DEFAULT 0,
    featured INTEGER NOT NULL DEFAULT 0,
    featured_note TEXT,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS builds_app ON builds (app_slug, status);
  CREATE INDEX IF NOT EXISTS builds_user ON builds (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS builds_user_slug ON builds (user_id, slug);
  CREATE TABLE IF NOT EXISTS build_media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    build_id TEXT,
    created_at BIGINT NOT NULL
  );
`;

/* Six fixed slots, three per rail side. Seed prices only — editable at runtime. */
const SLOT_SEED = [
  ['L1', 29900],
  ['R1', 39900],
  ['L2', 49900],
  ['R2', 59900],
  ['L3', 69900],
  ['R3', 79900],
  // Added at 8 slots (2026-08-01, launch night): seeds only apply to NEW rows —
  // existing slot prices set from the admin are never overwritten.
  ['L4', 119900],
  ['R4', 149900],
  // 10 slots (launch night +2, $999 cleared within the hour):
  ['L5', 149900],
  ['R5', 149900],
];

// Everything the slot-blocked predicate and the board care about. Anything else
// (expired, rejected, refunded_conflict, expired_hold) frees the slot.
const ACTIVE_STATUSES = ['hold', 'paid', 'submitted', 'reject_failed', 'live'];

// Whitelist: field names reach SQL as identifiers, so they can never come from a
// request body unchecked.
const PURCHASE_FIELDS = [
  'slot_id', 'status', 'stripe_session_id', 'stripe_payment_intent', 'amount_cents',
  'email', 'name', 'tagline', 'url', 'logo_url', 'tint', 'hold_expires_at', 'paid_at',
  'submitted_at', 'approved_at', 'starts_at', 'ends_at', 'reminder_details_at',
  'reminder_renew_at', 'reminder_offer_at', 'months',
];

const NUMERIC_COLUMNS = [
  'amount_cents', 'created_at', 'hold_expires_at', 'paid_at', 'submitted_at',
  'approved_at', 'starts_at', 'ends_at', 'reminder_details_at', 'reminder_renew_at',
  'reminder_offer_at', 'months',
];

// Postgres hands BIGINT back as a string; the rest of the code does date maths.
function purchaseRow(row) {
  if (!row) return null;
  const out = { ...row };
  for (const c of NUMERIC_COLUMNS) out[c] = out[c] == null ? null : Number(out[c]);
  return out;
}

function updateParts(fields) {
  const keys = Object.keys(fields).filter((k) => PURCHASE_FIELDS.includes(k));
  if (keys.length === 0) throw new Error('updatePurchase: no writable fields');
  return keys;
}

// Same rule for lookups: purchaseBy interpolates the column name, so it only
// accepts the three identifiers the exported helpers actually use.
const PURCHASE_LOOKUP_COLS = ['id', 'stripe_session_id', 'details_token'];

// Submission columns the pipeline may rewrite after insert. Same rule as
// PURCHASE_FIELDS: names reach SQL as identifiers, never from a request body.
const SUBMISSION_FIELDS = ['status', 'pr_url', 'error', 'updated_at'];

function submissionParts(fields) {
  const keys = Object.keys(fields).filter((k) => SUBMISSION_FIELDS.includes(k));
  if (keys.length === 0) throw new Error('updateSubmission: no writable fields');
  return keys;
}

// Statuses that mean "this slug is already being worked": a second visitor
// submitting the same app while these are live gets a duplicate answer.
// Time-bounded: a pipeline killed mid-run (deploy, crash) leaves its row in a
// non-terminal status forever, and without the cutoff that slug could never be
// submitted again. Matches the API route's 10-minute stall horizon.
const SUBMISSION_OPEN_STATUSES = ['queued', 'drafting', 'opening'];
const SUBMISSION_STALL_MS = 10 * 60 * 1000;

function lookupCol(column) {
  if (!PURCHASE_LOOKUP_COLS.includes(column)) {
    throw new Error(`purchaseBy: invalid column: ${column}`);
  }
  return column;
}

// Build columns the admin surface may rewrite after insert. Same rule as
// PURCHASE_FIELDS: names reach SQL as identifiers, never from a request body.
const BUILD_FIELDS = [
  'status', 'featured', 'featured_note', 'model_norm', 'media', 'og_image', 'updated_at',
];

function buildParts(fields) {
  const keys = Object.keys(fields).filter((k) => BUILD_FIELDS.includes(k));
  if (keys.length === 0) throw new Error('updateBuild: no writable fields');
  return keys;
}

// Postgres hands BIGINT back as strings; the pages do date maths on these.
const BUILD_NUMERIC = ['created_at', 'updated_at'];

function numericRow(cols) {
  return (row) => {
    if (!row) return null;
    const out = { ...row };
    for (const c of cols) out[c] = out[c] == null ? null : Number(out[c]);
    return out;
  };
}

const buildRow = numericRow(BUILD_NUMERIC);

let driver;

/* Raw connection handles, shared between the query driver below and Better
   Auth (which wants the pg Pool / better-sqlite3 Database instance itself).
   One pool, one sqlite handle, never two connections to the same store. */
let pgPool;
async function rawPgPool() {
  if (!pgPool) {
    const { default: pg } = await import('pg');
    pgPool = new pg.Pool({ connectionString: PG_URL, max: 5 });
  }
  return pgPool;
}

let sqliteDb;
async function rawSqliteDb() {
  if (!sqliteDb) {
    const { default: Database } = await import('better-sqlite3');
    const { mkdirSync } = await import('node:fs');
    const path = await import('node:path');
    const dir = process.env.DATA_DIR || 'data/private';
    mkdirSync(dir, { recursive: true });
    sqliteDb = new Database(path.join(dir, 'site.db'));
    sqliteDb.pragma('journal_mode = WAL');
  }
  return sqliteDb;
}

/* For Better Auth: the raw handle, guaranteed post-schema (getDriver applies
   the schema, including the auth tables). */
export async function authDatabase() {
  await getDriver();
  return PG_URL ? rawPgPool() : rawSqliteDb();
}

async function pgDriver() {
  const pool = await rawPgPool();
  await pool.query(SCHEMA_PG);
  // A NULL source means the row predates per-placement tracking: scanner era.
  await pool.query('ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS source TEXT');
  // Quarter deals: how many 30-day runs one payment covers (NULL = 1).
  await pool.query('ALTER TABLE sponsor_purchases ADD COLUMN IF NOT EXISTS months INTEGER');
  // What the slot's NEXT run is doing: pending | open | reserved. "Taken" is
  // never stored — it's derived from a future-dated purchase existing.
  await pool.query('ALTER TABLE sponsor_slots ADD COLUMN IF NOT EXISTS next_state TEXT');
  // The slot's private next-run offer price for its current occupant (cents).
  await pool.query('ALTER TABLE sponsor_slots ADD COLUMN IF NOT EXISTS renewal_price_cents INTEGER');
  // When the automated next-run offer email went out for a purchase.
  await pool.query('ALTER TABLE sponsor_purchases ADD COLUMN IF NOT EXISTS reminder_offer_at BIGINT');
  // Maker handle: claimed once at first build post, unique case-insensitive,
  // shown (and used in /builds URLs) instead of the OAuth display name.
  await pool.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "handle" TEXT');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS user_handle_unique ON "user" (lower("handle"))'
  );
  // Share card for an approved build, generated at approval and stored on R2.
  await pool.query('ALTER TABLE builds ADD COLUMN IF NOT EXISTS og_image TEXT');
  await pool.query("UPDATE waitlist SET source = 'scanner' WHERE source IS NULL");
  for (const [id, cents] of SLOT_SEED) {
    await pool.query(
      'INSERT INTO sponsor_slots (id, price_cents) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, cents]
    );
  }
  return {
    async voteCount(slug) {
      const r = await pool.query('SELECT count FROM votes WHERE slug = $1', [slug]);
      return r.rows[0]?.count ?? 0;
    },
    async allVotes() {
      const r = await pool.query('SELECT slug, count FROM votes');
      return r.rows;
    },
    async addVote(slug) {
      const r = await pool.query(
        `INSERT INTO votes (slug, count) VALUES ($1, 1)
         ON CONFLICT (slug) DO UPDATE SET count = votes.count + 1
         RETURNING count`,
        [slug]
      );
      return r.rows[0].count;
    },
    async removeVote(slug) {
      const r = await pool.query(
        `UPDATE votes SET count = GREATEST(count - 1, 0) WHERE slug = $1 RETURNING count`,
        [slug]
      );
      return r.rows[0]?.count ?? 0;
    },
    // Atomically spend a live rate-limit key: true only for the one caller
    // that got to delete it. Checking and clearing as two statements let two
    // concurrent unvotes both see the same key and both decrement.
    async consumeRateLimit(key, windowMs) {
      const r = await pool.query(
        'DELETE FROM rate_limits WHERE key = $1 AND window_start >= $2 RETURNING key',
        [key, Date.now() - windowMs]
      );
      return r.rowCount > 0;
    },
    async addEmail(email, source) {
      const r = await pool.query(
        'INSERT INTO waitlist (email, source) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [email, source]
      );
      return r.rowCount > 0;
    },
    async addSponsor(email, message) {
      await pool.query('INSERT INTO sponsors (email, message) VALUES ($1, $2)', [
        email,
        message,
      ]);
    },
    async rateLimit(key, max, windowMs) {
      const now = Date.now();
      const r = await pool.query('SELECT count, window_start FROM rate_limits WHERE key = $1', [key]);
      const row = r.rows[0];
      if (!row || now - Number(row.window_start) > windowMs) {
        await pool.query(
          `INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, $2)
           ON CONFLICT (key) DO UPDATE SET count = 1, window_start = $2`,
          [key, now]
        );
        return true;
      }
      if (row.count >= max) return false;
      await pool.query('UPDATE rate_limits SET count = count + 1 WHERE key = $1', [key]);
      return true;
    },
    async sponsorSlots() {
      const r = await pool.query(
        'SELECT id, price_cents, next_state, renewal_price_cents FROM sponsor_slots ORDER BY id'
      );
      return r.rows.map((s) => ({
        id: s.id,
        price_cents: Number(s.price_cents),
        next_state: s.next_state ?? null,
        renewal_price_cents: s.renewal_price_cents == null ? null : Number(s.renewal_price_cents),
      }));
    },
    async waitlistEmails(source) {
      const r = await pool.query('SELECT email FROM waitlist WHERE source = $1 ORDER BY created_at', [source]);
      return r.rows.map((x) => x.email);
    },
    async setSlotPrice(id, cents) {
      const r = await pool.query('UPDATE sponsor_slots SET price_cents = $2 WHERE id = $1', [id, cents]);
      return r.rowCount > 0;
    },
    async setSlotNextState(id, state) {
      const r = await pool.query('UPDATE sponsor_slots SET next_state = $2 WHERE id = $1', [id, state]);
      return r.rowCount > 0;
    },
    async insertPurchase(p) {
      await pool.query(
        `INSERT INTO sponsor_purchases
           (id, slot_id, status, amount_cents, months, details_token, created_at, hold_expires_at, stripe_session_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.id, p.slot_id, p.status, p.amount_cents, p.months ?? 1, p.details_token, p.created_at, p.hold_expires_at, p.stripe_session_id ?? null]
      );
    },
    async activePurchases() {
      const r = await pool.query(
        'SELECT * FROM sponsor_purchases WHERE status = ANY($1) ORDER BY created_at, id',
        [ACTIVE_STATUSES]
      );
      return r.rows.map(purchaseRow);
    },
    async purchaseBy(column, value) {
      const r = await pool.query(`SELECT * FROM sponsor_purchases WHERE ${lookupCol(column)} = $1`, [value]);
      return purchaseRow(r.rows[0]);
    },
    async updatePurchase(id, fields, whereStatusIn) {
      const keys = updateParts(fields);
      const params = [id, ...keys.map((k) => fields[k])];
      let sql = `UPDATE sponsor_purchases SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`;
      if (whereStatusIn) {
        params.push(whereStatusIn);
        sql += ` AND status = ANY($${params.length})`;
      }
      const r = await pool.query(sql, params);
      return r.rowCount;
    },
    async purchasesForAdmin(limit) {
      const r = await pool.query(
        'SELECT * FROM sponsor_purchases ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      return r.rows.map(purchaseRow);
    },
    async addSponsorClick(slotId, surface, country, ts) {
      await pool.query(
        'INSERT INTO sponsor_clicks (slot_id, surface, country, created_at) VALUES ($1, $2, $3, $4)',
        [slotId, surface, country, ts]
      );
    },
    async sponsorClickRows(sinceMs) {
      const r = await pool.query(
        `SELECT slot_id, surface, country, created_at FROM sponsor_clicks
         WHERE created_at >= $1 ORDER BY created_at DESC`,
        [sinceMs]
      );
      return r.rows.map((x) => ({ ...x, created_at: Number(x.created_at) }));
    },
    async bumpImpressions(entries) {
      for (const e of entries) {
        await pool.query(
          `INSERT INTO sponsor_impressions (slot_id, day, count) VALUES ($1, $2, $3)
           ON CONFLICT (slot_id, day)
           DO UPDATE SET count = sponsor_impressions.count + EXCLUDED.count`,
          [e.slot_id, e.day, e.count]
        );
      }
    },
    async impressionRows(sinceDay) {
      const r = await pool.query(
        'SELECT slot_id, day, count FROM sponsor_impressions WHERE day >= $1 ORDER BY day',
        [sinceDay]
      );
      return r.rows.map((x) => ({ ...x, count: Number(x.count) }));
    },
    async addSearch(query, hits, country, ts) {
      await pool.query(
        'INSERT INTO searches (query, hits, country, created_at) VALUES ($1, $2, $3, $4)',
        [query, hits, country, ts]
      );
    },
    async searchRows(afterId, limit) {
      const r = await pool.query(
        'SELECT id, query, hits, country, created_at FROM searches WHERE id > $1 ORDER BY id LIMIT $2',
        [afterId, limit]
      );
      return r.rows.map((x) => ({ ...x, id: Number(x.id), created_at: Number(x.created_at) }));
    },
    async stackAdd(userId, slug) {
      const r = await pool.query(
        'INSERT INTO stack (user_id, app_slug, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [userId, slug, Date.now()]
      );
      return r.rowCount > 0;
    },
    async stackRemove(userId, slug) {
      const r = await pool.query('DELETE FROM stack WHERE user_id = $1 AND app_slug = $2', [userId, slug]);
      return r.rowCount > 0;
    },
    async stackSlugs(userId) {
      const r = await pool.query(
        'SELECT app_slug FROM stack WHERE user_id = $1 ORDER BY created_at DESC, app_slug',
        [userId]
      );
      return r.rows.map((x) => x.app_slug);
    },
    async stackClear(userId) {
      await pool.query('DELETE FROM stack WHERE user_id = $1', [userId]);
    },
    async setUserNewsletter(userId, on) {
      await pool.query('UPDATE "user" SET "newsletter" = $2 WHERE "id" = $1', [userId, on]);
    },
    async removeFromWaitlist(email) {
      await pool.query('DELETE FROM waitlist WHERE email = $1', [email]);
    },
    async sponsorTotals() {
      const [imp, clk] = await Promise.all([
        pool.query('SELECT COALESCE(SUM(count), 0) AS n, MIN(day) AS since FROM sponsor_impressions'),
        pool.query('SELECT COUNT(*) AS n, MIN(created_at) AS since FROM sponsor_clicks'),
      ]);
      return {
        impressions: Number(imp.rows[0].n),
        impressionsSince: imp.rows[0].since ?? null,
        clicks: Number(clk.rows[0].n),
        clicksSince: clk.rows[0].since == null ? null : Number(clk.rows[0].since),
      };
    },
    async insertSubmission(s) {
      await pool.query(
        `INSERT INTO submissions (id, slug, app_name, app_url, take, submitter, user_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [s.id, s.slug, s.app_name, s.app_url, s.take, s.submitter, s.user_id, s.status, s.created_at]
      );
    },
    async updateSubmission(id, fields) {
      const keys = submissionParts(fields);
      const params = [id, ...keys.map((k) => fields[k])];
      await pool.query(
        `UPDATE submissions SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
        params
      );
    },
    async submissionById(id) {
      const r = await pool.query('SELECT * FROM submissions WHERE id = $1', [id]);
      return r.rows[0] ?? null;
    },
    async openSubmissionBySlug(slug) {
      const r = await pool.query(
        'SELECT * FROM submissions WHERE slug = $1 AND status = ANY($2) AND updated_at > $3 LIMIT 1',
        [slug, SUBMISSION_OPEN_STATUSES, Date.now() - SUBMISSION_STALL_MS]
      );
      return r.rows[0] ?? null;
    },
    async insertBuild(b) {
      await pool.query(
        `INSERT INTO builds
           (id, user_id, app_slug, name, slug, one_liner, goes, prompt, story,
            where_broke, tool, model, model_norm, demo_url, repo_url, chat_url,
            media, affiliation, by_owner, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20, $21, $21)`,
        [b.id, b.user_id, b.app_slug, b.name, b.slug, b.one_liner, b.goes, b.prompt,
         b.story, b.where_broke, b.tool, b.model, b.model_norm, b.demo_url, b.repo_url,
         b.chat_url, b.media, b.affiliation, b.by_owner, b.status, b.created_at]
      );
    },
    async updateBuild(id, fields) {
      const keys = buildParts(fields);
      const params = [id, ...keys.map((k) => fields[k])];
      const r = await pool.query(
        `UPDATE builds SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
        params
      );
      return r.rowCount;
    },
    async buildById(id) {
      const r = await pool.query('SELECT * FROM builds WHERE id = $1', [id]);
      return buildRow(r.rows[0]);
    },
    async liveBuilds() {
      const r = await pool.query(
        "SELECT * FROM builds WHERE status = 'live' ORDER BY created_at DESC"
      );
      return r.rows.map(buildRow);
    },
    async pendingBuilds() {
      const r = await pool.query(
        "SELECT * FROM builds WHERE status = 'pending' ORDER BY created_at ASC"
      );
      return r.rows.map(buildRow);
    },
    async buildUserNames(ids) {
      if (!ids.length) return [];
      const r = await pool.query(
        'SELECT "id", "name", "handle" FROM "user" WHERE "id" = ANY($1)',
        [ids]
      );
      return r.rows;
    },
    async userHandle(userId) {
      const r = await pool.query('SELECT "handle" FROM "user" WHERE "id" = $1', [userId]);
      return r.rows[0]?.handle ?? null;
    },
    // Set-once: only fills a NULL handle; the unique index turns a race for
    // the same handle into a caught error -> false.
    async setUserHandle(userId, handle) {
      try {
        const r = await pool.query(
          'UPDATE "user" SET "handle" = $2 WHERE "id" = $1 AND "handle" IS NULL',
          [userId, handle]
        );
        return r.rowCount > 0;
      } catch (err) {
        if (/unique|duplicate/i.test(err.message)) return false;
        throw err;
      }
    },
    async userByHandle(handle) {
      const r = await pool.query(
        'SELECT "id", "name", "handle" FROM "user" WHERE lower("handle") = lower($1)',
        [handle]
      );
      return r.rows[0] ?? null;
    },
    async buildByUserSlug(userId, slug) {
      const r = await pool.query(
        'SELECT * FROM builds WHERE user_id = $1 AND slug = $2',
        [userId, slug]
      );
      return buildRow(r.rows[0]);
    },
    async userBuildSlugs(userId) {
      const r = await pool.query('SELECT slug FROM builds WHERE user_id = $1', [userId]);
      return r.rows.map((x) => x.slug);
    },
    async githubAccountOf(userId) {
      const r = await pool.query(
        `SELECT "accountId" FROM "account" WHERE "userId" = $1 AND "providerId" = 'github' LIMIT 1`,
        [userId]
      );
      return r.rows[0]?.accountId ?? null;
    },
    async insertBuildMedia(m) {
      await pool.query(
        'INSERT INTO build_media (id, user_id, key, created_at) VALUES ($1, $2, $3, $4)',
        [m.id, m.user_id, m.key, m.created_at]
      );
    },
    async mediaOwnedBy(ids, userId) {
      if (!ids.length) return [];
      const r = await pool.query(
        'SELECT id, key FROM build_media WHERE id = ANY($1) AND user_id = $2 AND build_id IS NULL',
        [ids, userId]
      );
      return r.rows;
    },
    async claimBuildMedia(ids, buildId, userId) {
      if (!ids.length) return;
      await pool.query(
        'UPDATE build_media SET build_id = $2 WHERE id = ANY($1) AND user_id = $3 AND build_id IS NULL',
        [ids, buildId, userId]
      );
    },
  };
}

async function sqliteDriver() {
  const db = await rawSqliteDb();
  db.exec(SCHEMA_SQLITE);
  // A NULL source means the row predates per-placement tracking: scanner era.
  try {
    db.exec('ALTER TABLE waitlist ADD COLUMN source TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  // Quarter deals: how many 30-day runs one payment covers (NULL = 1).
  try {
    db.exec('ALTER TABLE sponsor_purchases ADD COLUMN months INTEGER');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  // What the slot's NEXT run is doing: pending | open | reserved.
  try {
    db.exec('ALTER TABLE sponsor_slots ADD COLUMN next_state TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  // The slot's private next-run offer price for its current occupant (cents).
  try {
    db.exec('ALTER TABLE sponsor_slots ADD COLUMN renewal_price_cents INTEGER');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  // When the automated next-run offer email went out for a purchase.
  try {
    db.exec('ALTER TABLE sponsor_purchases ADD COLUMN reminder_offer_at INTEGER');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  // Maker handle: claimed once at first build post, unique case-insensitive,
  // shown (and used in /builds URLs) instead of the OAuth display name.
  try {
    db.exec('ALTER TABLE "user" ADD COLUMN "handle" TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_handle_unique ON "user" (lower("handle"))');
  // Share card for an approved build, generated at approval and stored on R2.
  try {
    db.exec('ALTER TABLE builds ADD COLUMN og_image TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
  db.exec("UPDATE waitlist SET source = 'scanner' WHERE source IS NULL");
  const seedSlot = db.prepare('INSERT OR IGNORE INTO sponsor_slots (id, price_cents) VALUES (?, ?)');
  for (const [id, cents] of SLOT_SEED) seedSlot.run(id, cents);
  const stmts = {
    getVote: db.prepare('SELECT count FROM votes WHERE slug = ?'),
    allVotes: db.prepare('SELECT slug, count FROM votes'),
    addVote: db.prepare(`
      INSERT INTO votes (slug, count) VALUES (?, 1)
      ON CONFLICT(slug) DO UPDATE SET count = count + 1
    `),
    addEmail: db.prepare('INSERT OR IGNORE INTO waitlist (email, source) VALUES (?, ?)'),
    addSponsor: db.prepare('INSERT INTO sponsors (email, message) VALUES (?, ?)'),
    getLimit: db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?'),
    setLimit: db.prepare(`
      INSERT INTO rate_limits (key, count, window_start) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start
    `),
    bumpLimit: db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?'),
  };
  return {
    async voteCount(slug) {
      return stmts.getVote.get(slug)?.count ?? 0;
    },
    async allVotes() {
      return stmts.allVotes.all();
    },
    async addVote(slug) {
      stmts.addVote.run(slug);
      return stmts.getVote.get(slug).count;
    },
    async removeVote(slug) {
      db.prepare('UPDATE votes SET count = max(count - 1, 0) WHERE slug = ?').run(slug);
      return stmts.getVote.get(slug)?.count ?? 0;
    },
    // Atomically spend a live rate-limit key: true only for the one caller
    // that got to delete it. Checking and clearing as two statements let two
    // concurrent unvotes both see the same key and both decrement.
    async consumeRateLimit(key, windowMs) {
      const r = db
        .prepare('DELETE FROM rate_limits WHERE key = ? AND window_start >= ?')
        .run(key, Date.now() - windowMs);
      return r.changes > 0;
    },
    async addEmail(email, source) {
      return stmts.addEmail.run(email, source).changes > 0;
    },
    async addSponsor(email, message) {
      stmts.addSponsor.run(email, message);
    },
    async rateLimit(key, max, windowMs) {
      const now = Date.now();
      const row = stmts.getLimit.get(key);
      if (!row || now - row.window_start > windowMs) {
        stmts.setLimit.run(key, 1, now);
        return true;
      }
      if (row.count >= max) return false;
      stmts.bumpLimit.run(key);
      return true;
    },
    async sponsorSlots() {
      return db
        .prepare('SELECT id, price_cents, next_state, renewal_price_cents FROM sponsor_slots ORDER BY id')
        .all();
    },
    async waitlistEmails(source) {
      return db.prepare('SELECT email FROM waitlist WHERE source = ? ORDER BY created_at').all(source)
        .map((x) => x.email);
    },
    async setSlotPrice(id, cents) {
      return db.prepare('UPDATE sponsor_slots SET price_cents = ? WHERE id = ?').run(cents, id).changes > 0;
    },
    async setSlotNextState(id, state) {
      return db.prepare('UPDATE sponsor_slots SET next_state = ? WHERE id = ?').run(state, id).changes > 0;
    },
    async insertPurchase(p) {
      db.prepare(
        `INSERT INTO sponsor_purchases
           (id, slot_id, status, amount_cents, months, details_token, created_at, hold_expires_at, stripe_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(p.id, p.slot_id, p.status, p.amount_cents, p.months ?? 1, p.details_token, p.created_at, p.hold_expires_at, p.stripe_session_id ?? null);
    },
    async activePurchases() {
      const marks = ACTIVE_STATUSES.map(() => '?').join(', ');
      return db
        .prepare(`SELECT * FROM sponsor_purchases WHERE status IN (${marks}) ORDER BY created_at, id`)
        .all(...ACTIVE_STATUSES)
        .map(purchaseRow);
    },
    async purchaseBy(column, value) {
      return purchaseRow(db.prepare(`SELECT * FROM sponsor_purchases WHERE ${lookupCol(column)} = ?`).get(value));
    },
    async updatePurchase(id, fields, whereStatusIn) {
      const keys = updateParts(fields);
      const params = [...keys.map((k) => fields[k]), id];
      let sql = `UPDATE sponsor_purchases SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
      if (whereStatusIn) {
        sql += ` AND status IN (${whereStatusIn.map(() => '?').join(', ')})`;
        params.push(...whereStatusIn);
      }
      return db.prepare(sql).run(...params).changes;
    },
    async purchasesForAdmin(limit) {
      return db
        .prepare('SELECT * FROM sponsor_purchases ORDER BY created_at DESC LIMIT ?')
        .all(limit)
        .map(purchaseRow);
    },
    async addSponsorClick(slotId, surface, country, ts) {
      db.prepare(
        'INSERT INTO sponsor_clicks (slot_id, surface, country, created_at) VALUES (?, ?, ?, ?)'
      ).run(slotId, surface, country, ts);
    },
    async sponsorClickRows(sinceMs) {
      return db
        .prepare(
          `SELECT slot_id, surface, country, created_at FROM sponsor_clicks
           WHERE created_at >= ? ORDER BY created_at DESC`
        )
        .all(sinceMs);
    },
    async bumpImpressions(entries) {
      const stmt = db.prepare(
        `INSERT INTO sponsor_impressions (slot_id, day, count) VALUES (?, ?, ?)
         ON CONFLICT (slot_id, day) DO UPDATE SET count = count + excluded.count`
      );
      for (const e of entries) stmt.run(e.slot_id, e.day, e.count);
    },
    async impressionRows(sinceDay) {
      return db
        .prepare('SELECT slot_id, day, count FROM sponsor_impressions WHERE day >= ? ORDER BY day')
        .all(sinceDay);
    },
    async addSearch(query, hits, country, ts) {
      db.prepare(
        'INSERT INTO searches (query, hits, country, created_at) VALUES (?, ?, ?, ?)'
      ).run(query, hits, country, ts);
    },
    async searchRows(afterId, limit) {
      return db
        .prepare(
          'SELECT id, query, hits, country, created_at FROM searches WHERE id > ? ORDER BY id LIMIT ?'
        )
        .all(afterId, limit);
    },
    async stackAdd(userId, slug) {
      return db
        .prepare('INSERT OR IGNORE INTO stack (user_id, app_slug, created_at) VALUES (?, ?, ?)')
        .run(userId, slug, Date.now()).changes > 0;
    },
    async stackRemove(userId, slug) {
      return db.prepare('DELETE FROM stack WHERE user_id = ? AND app_slug = ?').run(userId, slug).changes > 0;
    },
    async stackSlugs(userId) {
      return db
        .prepare('SELECT app_slug FROM stack WHERE user_id = ? ORDER BY created_at DESC, app_slug')
        .all(userId)
        .map((x) => x.app_slug);
    },
    async stackClear(userId) {
      db.prepare('DELETE FROM stack WHERE user_id = ?').run(userId);
    },
    async setUserNewsletter(userId, on) {
      db.prepare('UPDATE "user" SET "newsletter" = ? WHERE "id" = ?').run(on ? 1 : 0, userId);
    },
    async removeFromWaitlist(email) {
      db.prepare('DELETE FROM waitlist WHERE email = ?').run(email);
    },
    async sponsorTotals() {
      const imp = db
        .prepare('SELECT COALESCE(SUM(count), 0) AS n, MIN(day) AS since FROM sponsor_impressions')
        .get();
      const clk = db
        .prepare('SELECT COUNT(*) AS n, MIN(created_at) AS since FROM sponsor_clicks')
        .get();
      return {
        impressions: Number(imp.n),
        impressionsSince: imp.since ?? null,
        clicks: Number(clk.n),
        clicksSince: clk.since == null ? null : Number(clk.since),
      };
    },
    async insertSubmission(s) {
      db.prepare(
        `INSERT INTO submissions (id, slug, app_name, app_url, take, submitter, user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(s.id, s.slug, s.app_name, s.app_url, s.take, s.submitter, s.user_id, s.status, s.created_at, s.created_at);
    },
    async updateSubmission(id, fields) {
      const keys = submissionParts(fields);
      db.prepare(
        `UPDATE submissions SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`
      ).run(...keys.map((k) => fields[k]), id);
    },
    async submissionById(id) {
      return db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) ?? null;
    },
    async openSubmissionBySlug(slug) {
      const marks = SUBMISSION_OPEN_STATUSES.map(() => '?').join(', ');
      return (
        db
          .prepare(
            `SELECT * FROM submissions WHERE slug = ? AND status IN (${marks}) AND updated_at > ? LIMIT 1`
          )
          .get(slug, ...SUBMISSION_OPEN_STATUSES, Date.now() - SUBMISSION_STALL_MS) ?? null
      );
    },
    async insertBuild(b) {
      db.prepare(
        `INSERT INTO builds
           (id, user_id, app_slug, name, slug, one_liner, goes, prompt, story,
            where_broke, tool, model, model_norm, demo_url, repo_url, chat_url,
            media, affiliation, by_owner, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        b.id, b.user_id, b.app_slug, b.name, b.slug, b.one_liner, b.goes, b.prompt,
        b.story, b.where_broke, b.tool, b.model, b.model_norm, b.demo_url, b.repo_url,
        b.chat_url, b.media, b.affiliation, b.by_owner, b.status, b.created_at,
        b.created_at
      );
    },
    async updateBuild(id, fields) {
      const keys = buildParts(fields);
      return db
        .prepare(`UPDATE builds SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => fields[k]), id).changes;
    },
    async buildById(id) {
      return buildRow(db.prepare('SELECT * FROM builds WHERE id = ?').get(id));
    },
    async liveBuilds() {
      return db
        .prepare("SELECT * FROM builds WHERE status = 'live' ORDER BY created_at DESC")
        .all()
        .map(buildRow);
    },
    async pendingBuilds() {
      return db
        .prepare("SELECT * FROM builds WHERE status = 'pending' ORDER BY created_at ASC")
        .all()
        .map(buildRow);
    },
    async buildUserNames(ids) {
      if (!ids.length) return [];
      const marks = ids.map(() => '?').join(', ');
      return db
        .prepare(`SELECT "id", "name", "handle" FROM "user" WHERE "id" IN (${marks})`)
        .all(...ids);
    },
    async userHandle(userId) {
      return db.prepare('SELECT "handle" FROM "user" WHERE "id" = ?').get(userId)?.handle ?? null;
    },
    async setUserHandle(userId, handle) {
      try {
        return (
          db.prepare('UPDATE "user" SET "handle" = ? WHERE "id" = ? AND "handle" IS NULL')
            .run(handle, userId).changes > 0
        );
      } catch (err) {
        if (/unique|constraint/i.test(err.message)) return false;
        throw err;
      }
    },
    async userByHandle(handle) {
      return (
        db.prepare('SELECT "id", "name", "handle" FROM "user" WHERE lower("handle") = lower(?)')
          .get(handle) ?? null
      );
    },
    async buildByUserSlug(userId, slug) {
      return buildRow(
        db.prepare('SELECT * FROM builds WHERE user_id = ? AND slug = ?').get(userId, slug)
      );
    },
    async userBuildSlugs(userId) {
      return db.prepare('SELECT slug FROM builds WHERE user_id = ?').all(userId).map((x) => x.slug);
    },
    async githubAccountOf(userId) {
      return (
        db.prepare(
          `SELECT "accountId" FROM "account" WHERE "userId" = ? AND "providerId" = 'github' LIMIT 1`
        ).get(userId)?.accountId ?? null
      );
    },
    async insertBuildMedia(m) {
      db.prepare(
        'INSERT INTO build_media (id, user_id, key, created_at) VALUES (?, ?, ?, ?)'
      ).run(m.id, m.user_id, m.key, m.created_at);
    },
    async mediaOwnedBy(ids, userId) {
      if (!ids.length) return [];
      const marks = ids.map(() => '?').join(', ');
      return db
        .prepare(
          `SELECT id, key FROM build_media WHERE id IN (${marks}) AND user_id = ? AND build_id IS NULL`
        )
        .all(...ids, userId);
    },
    async claimBuildMedia(ids, buildId, userId) {
      if (!ids.length) return;
      const marks = ids.map(() => '?').join(', ');
      db.prepare(
        `UPDATE build_media SET build_id = ? WHERE id IN (${marks}) AND user_id = ? AND build_id IS NULL`
      ).run(buildId, ...ids, userId);
    },
  };
}

async function getDriver() {
  // A rejected init must not be cached: clear it so the next request retries
  // (a Postgres blip would otherwise take the DB layer down until restart).
  if (!driver) {
    driver = (PG_URL ? pgDriver() : sqliteDriver()).catch((err) => {
      driver = null;
      throw err;
    });
  }
  return driver;
}

export async function voteCount(slug) {
  return (await getDriver()).voteCount(slug);
}

export async function voteCounts() {
  const rows = await (await getDriver()).allVotes();
  const map = new Map(rows.map((r) => [r.slug, Number(r.count)]));
  return (slug) => map.get(slug) ?? 0;
}

export async function addVote(slug) {
  return (await getDriver()).addVote(slug);
}

export async function removeVote(slug) {
  return (await getDriver()).removeVote(slug);
}

export async function consumeRateLimit(key, windowMs) {
  return (await getDriver()).consumeRateLimit(key, windowMs);
}

export async function addToWaitlist(email, source) {
  return (await getDriver()).addEmail(email, source);
}

export async function addSponsorInquiry(email, message) {
  return (await getDriver()).addSponsor(email, message?.slice(0, 2000) ?? null);
}

export async function rateLimit(key, max, windowMs) {
  return (await getDriver()).rateLimit(key, max, windowMs);
}

export async function sponsorSlots() {
  return (await getDriver()).sponsorSlots();
}

export async function setSlotPrice(id, priceCents) {
  return (await getDriver()).setSlotPrice(id, priceCents);
}

export async function setSlotNextState(id, state) {
  return (await getDriver()).setSlotNextState(id, state);
}

export async function waitlistEmails(source) {
  return (await getDriver()).waitlistEmails(source);
}

export async function insertPurchase(purchase) {
  return (await getDriver()).insertPurchase(purchase);
}

export async function activePurchases() {
  return (await getDriver()).activePurchases();
}

export async function purchaseById(id) {
  return (await getDriver()).purchaseBy('id', id);
}

export async function purchaseBySession(sessionId) {
  return (await getDriver()).purchaseBy('stripe_session_id', sessionId);
}

export async function purchaseByToken(token) {
  return (await getDriver()).purchaseBy('details_token', token);
}

/* The idempotency primitive: every state transition is a conditional update and
   the row count says whether this caller was the one that made it. A duplicate
   webhook gets 0 and does nothing. */
export async function updatePurchase(id, fields, whereStatusIn) {
  return (await getDriver()).updatePurchase(id, fields, whereStatusIn);
}

export async function addSponsorClick(slotId, surface, country, ts = Date.now()) {
  return (await getDriver()).addSponsorClick(slotId, surface, country, ts);
}

export async function sponsorClickRows(sinceMs = 0) {
  return (await getDriver()).sponsorClickRows(sinceMs);
}

export async function bumpImpressions(entries) {
  return (await getDriver()).bumpImpressions(entries);
}

export async function impressionRows(sinceDay = '0000-00-00') {
  return (await getDriver()).impressionRows(sinceDay);
}

// All-time aggregates across every slot: the public /stats page shows only
// these sums, never per-slot numbers. Cached briefly: the page renders per
// request and two table scans per pageview would be pure waste.
let totalsCache = { at: 0, data: null };
export async function sponsorTotals() {
  const now = Date.now();
  if (now - totalsCache.at < 60_000) return totalsCache.data;
  totalsCache = { at: now, data: await (await getDriver()).sponsorTotals() };
  return totalsCache.data;
}

export async function addSearch(query, hits, country, ts = Date.now()) {
  return (await getDriver()).addSearch(query, hits, country, ts);
}

// Incremental export for the off-site audit log: rows strictly after `afterId`,
// oldest first, so the puller can resume from the last id it has seen.
export async function searchRows(afterId = 0, limit = 5000) {
  return (await getDriver()).searchRows(afterId, limit);
}

export async function purchasesForAdmin(limit = 60) {
  return (await getDriver()).purchasesForAdmin(limit);
}

export async function stackAdd(userId, slug) {
  return (await getDriver()).stackAdd(userId, slug);
}

export async function stackRemove(userId, slug) {
  return (await getDriver()).stackRemove(userId, slug);
}

export async function stackSlugs(userId) {
  return (await getDriver()).stackSlugs(userId);
}

// GDPR delete-account cascade. SQLite doesn't enforce FKs by default, so this
// is the delete path on both drivers rather than trusting ON DELETE CASCADE.
export async function stackClear(userId) {
  return (await getDriver()).stackClear(userId);
}

export async function setUserNewsletter(userId, on) {
  return (await getDriver()).setUserNewsletter(userId, on);
}

export async function removeFromWaitlist(email) {
  return (await getDriver()).removeFromWaitlist(email);
}

export async function insertSubmission(s) {
  return (await getDriver()).insertSubmission(s);
}

export async function updateSubmission(id, fields) {
  return (await getDriver()).updateSubmission(id, { ...fields, updated_at: Date.now() });
}

export async function submissionById(id) {
  return (await getDriver()).submissionById(id);
}

export async function openSubmissionBySlug(slug) {
  return (await getDriver()).openSubmissionBySlug(slug);
}

/* ---------- builds ---------- */

export async function insertBuild(b) {
  return (await getDriver()).insertBuild(b);
}

export async function updateBuild(id, fields) {
  return (await getDriver()).updateBuild(id, { ...fields, updated_at: Date.now() });
}

export async function buildById(id) {
  return (await getDriver()).buildById(id);
}

// All live builds, newest first. The pages filter/sort in JS — the whole
// table is small and one query keeps both drivers trivial.
export async function liveBuilds() {
  return (await getDriver()).liveBuilds();
}

// The admin approval queue, oldest first.
export async function pendingBuilds() {
  return (await getDriver()).pendingBuilds();
}

// Maker identities for build pages, one round trip per page: the claimed
// handle (display + URLs) with the OAuth name as fallback.
export async function buildUserNames(ids) {
  const rows = await (await getDriver()).buildUserNames([...new Set(ids)]);
  return new Map(rows.map((r) => [r.id, { name: r.name, handle: r.handle ?? null }]));
}

export async function userHandle(userId) {
  return (await getDriver()).userHandle(userId);
}

// Set-once, unique case-insensitive; false = already set or already taken.
export async function setUserHandle(userId, handle) {
  return (await getDriver()).setUserHandle(userId, handle);
}

export async function userByHandle(handle) {
  return (await getDriver()).userByHandle(handle);
}

export async function buildByUserSlug(userId, slug) {
  return (await getDriver()).buildByUserSlug(userId, slug);
}

// Existing slugs for one maker, so a repeat name gets -2, -3, … at insert.
export async function userBuildSlugs(userId) {
  return (await getDriver()).userBuildSlugs(userId);
}

// The linked GitHub account's numeric user id (Better Auth stores no login),
// or null when the user never connected GitHub.
export async function githubAccountOf(userId) {
  return (await getDriver()).githubAccountOf(userId);
}

export async function insertBuildMedia(m) {
  return (await getDriver()).insertBuildMedia(m);
}

export async function mediaOwnedBy(ids, userId) {
  return (await getDriver()).mediaOwnedBy(ids, userId);
}

export async function claimBuildMedia(ids, buildId, userId) {
  return (await getDriver()).claimBuildMedia(ids, buildId, userId);
}

// The headline number: total monthly cost of every subscription on the death list.
export function mrrDestroyed(apps) {
  return Math.round(apps.reduce((sum, a) => sum + (a.priceMonthly ?? 0), 0));
}
