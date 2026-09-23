'use strict';

const { Pool } = require('pg');

let pool = null;
let bootstrapPromise = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw Object.assign(new Error('DATABASE_URL is not configured.'), { status: 500, code: 'SERVER_NOT_CONFIGURED' });
  }
  if (!pool) {
    const url = process.env.DATABASE_URL;
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: isLocal || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000,
    });
  }
  return pool;
}

async function query(text, params) {
  await ensurePlatformSchema();
  return getPool().query(text, params);
}

// Runs fn(client) inside a transaction.
async function tx(fn) {
  await ensurePlatformSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Identifier safety ----------
const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;

function ident(name) {
  if (!IDENT_RE.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}

function literal(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------- Platform schema (shared registry of companies & logins) ----------
const PLATFORM_SQL = `
CREATE SCHEMA IF NOT EXISTS platform;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;

CREATE TABLE IF NOT EXISTS platform.companies (
  id                     text PRIMARY KEY,
  name                   text NOT NULL,
  domain                 text,
  schema_name            text NOT NULL UNIQUE,
  admin_email            text NOT NULL,
  is_master_vip          boolean NOT NULL DEFAULT false,
  plan                   text,
  seats                  integer NOT NULL DEFAULT 5,
  billing_cycle          text NOT NULL DEFAULT 'monthly',
  trial_used             boolean NOT NULL DEFAULT false,
  trial_ends_at          timestamptz,
  paid_until             timestamptz,
  paid_at                timestamptz,
  license_key            text,
  last_transaction_id    text,
  pending_wire_reference text,
  pending_order_id       text,
  pending_order_seats    integer,
  pending_order_cycle    text,
  logo                   text,
  smtp                   jsonb,
  db_role                text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.accounts (
  user_id              text PRIMARY KEY,
  company_id           text NOT NULL REFERENCES platform.companies(id) ON DELETE CASCADE,
  email                text NOT NULL UNIQUE,
  password_hash        text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT false,
  role                 text NOT NULL,
  token_version        integer NOT NULL DEFAULT 0,
  failed_attempts      integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  invited_at           timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_company_idx ON platform.accounts(company_id);

CREATE TABLE IF NOT EXISTS platform.registrations (
  id                 text PRIMARY KEY,
  email              text NOT NULL,
  data               jsonb NOT NULL,
  password_hash      text NOT NULL,
  otp_hash           text,
  otp_expires_at     timestamptz,
  otp_attempts       integer NOT NULL DEFAULT 0,
  otp_sends          integer NOT NULL DEFAULT 0,
  otp_sent_at        timestamptz,
  email_verified     boolean NOT NULL DEFAULT false,
  razorpay_order_id  text,
  order_seats        integer,
  order_cycle        text,
  completed          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registrations_email_idx ON platform.registrations(email);

CREATE TABLE IF NOT EXISTS platform.license_keys (
  key          text PRIMARY KEY,
  seats        integer NOT NULL DEFAULT 50,
  valid_days   integer,
  redeemed_by  text REFERENCES platform.companies(id) ON DELETE SET NULL,
  redeemed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.payments (
  id               text PRIMARY KEY,
  order_id         text NOT NULL,
  company_id       text,
  registration_id  text,
  amount           integer NOT NULL,
  currency         text NOT NULL,
  seats            integer NOT NULL,
  cycle            text NOT NULL,
  status           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
`;

function ensurePlatformSchema() {
  if (!bootstrapPromise) {
    bootstrapPromise = getPool().query(PLATFORM_SQL).catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}

// ---------- Tenant (per-company) schema ----------
const TENANT_STORES = ['teams', 'users', 'tasks', 'daily_updates', 'audit_logs', 'settings'];

function tenantSchemaSql(schema) {
  const s = ident(schema);
  const tables = TENANT_STORES.map((t) => `
    CREATE TABLE IF NOT EXISTS ${s}.${ident(t)} (
      id         text PRIMARY KEY,
      data       jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );`).join('\n');

  // Typed, read-friendly views for companies connecting with their own SQL / BI tools.
  const views = `
    CREATE OR REPLACE VIEW ${s}.v_tasks AS
      SELECT id, data->>'title' AS title, data->>'desc' AS description, data->>'status' AS status,
             data->>'priority' AS priority, data->>'teamId' AS team_id, data->>'assigneeId' AS assignee_id,
             data->>'dueDate' AS due_date, data->'tags' AS tags, updated_at
      FROM ${s}.tasks;
    CREATE OR REPLACE VIEW ${s}.v_members AS
      SELECT id, data->>'name' AS name, data->>'email' AS email, data->>'role' AS role,
             data->>'teamId' AS team_id, data->>'isFloatingSupport' = 'true' AS is_floating_support,
             data->'skills' AS skills, updated_at
      FROM ${s}.users;
    CREATE OR REPLACE VIEW ${s}.v_teams AS
      SELECT id, data->>'name' AS name, data->>'desc' AS description, data->>'leadId' AS lead_id, updated_at
      FROM ${s}.teams;
    CREATE OR REPLACE VIEW ${s}.v_daily_updates AS
      SELECT id, data->>'date' AS date, data->>'userId' AS user_id, data->>'hours' AS hours,
             data->>'accomplishments' AS accomplishments, data->>'nextPlans' AS next_plans,
             data->>'blockers' AS blockers, updated_at
      FROM ${s}.daily_updates;
    CREATE OR REPLACE VIEW ${s}.v_audit_logs AS
      SELECT id, data->>'timestamp' AS logged_at, data->>'actorName' AS actor_name,
             data->>'actorRole' AS actor_role, data->>'action' AS action, data->>'targetId' AS target_id,
             data->'details' AS details, data->>'blockHash' AS block_hash
      FROM ${s}.audit_logs;`;

  return `CREATE SCHEMA IF NOT EXISTS ${s};\nREVOKE ALL ON SCHEMA ${s} FROM PUBLIC;\n${tables}\n${views}`;
}

module.exports = {
  getPool,
  query,
  tx,
  ident,
  literal,
  ensurePlatformSchema,
  tenantSchemaSql,
  TENANT_STORES,
};
