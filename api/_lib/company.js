'use strict';

const crypto = require('crypto');
const { ident, tenantSchemaSql, TENANT_STORES } = require('./db');
const { pricing } = require('./billing');

const ROLES = ['Admin', 'Lead', 'TM', 'Support', 'Auditor'];
const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80';

// Master (free, unlimited) access is reserved for this single verified address and is not configurable.
const MASTER_EMAIL = 'equisteg@gmail.com';

function isMasterEmail(email) {
  return String(email || '').trim().toLowerCase() === MASTER_EMAIL;
}

function accessState(c) {
  const now = Date.now();
  if (c.is_master_vip) return { hasAccess: true, isPaid: true, trialDaysLeft: 0 };
  const paid = c.paid_until && new Date(c.paid_until).getTime() > now;
  const trialMs = c.trial_ends_at ? new Date(c.trial_ends_at).getTime() - now : 0;
  const trialDaysLeft = trialMs > 0 ? Math.ceil(trialMs / 86400000) : 0;
  return { hasAccess: Boolean(paid || trialDaysLeft > 0), isPaid: Boolean(paid), trialDaysLeft };
}

// Shape consumed by the web client (mirrors the old IndexedDB `company` record).
function companyDTO(c) {
  const a = accessState(c);
  const p = pricing();
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    adminEmail: c.admin_email,
    verifiedEmail: c.admin_email,
    isMasterVIP: c.is_master_vip,
    isUnlimited: c.is_master_vip,
    plan: c.plan,
    isPaid: a.isPaid,
    hasAccess: a.hasAccess,
    trialDaysLeft: a.trialDaysLeft,
    trialEndsAt: c.trial_ends_at,
    trialUsed: c.trial_used,
    paidUntil: c.paid_until,
    paidAt: c.paid_at,
    seats: c.is_master_vip ? 999999 : c.seats,
    billingCycle: c.billing_cycle,
    pricePerUser: c.is_master_vip ? 0 : (c.billing_cycle === 'yearly' ? p.yearly : p.monthly),
    currency: p.currency,
    licenseKey: c.license_key,
    lastTransactionId: c.last_transaction_id,
    pendingWireReference: c.pending_wire_reference,
    logo: c.logo,
    schemaName: c.schema_name,
    smtpConfigured: Boolean(c.smtp && c.smtp.host),
    dbAccessEnabled: Boolean(c.db_role),
  };
}

function makeSchemaName(companyName) {
  const slug = String(companyName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'company';
  return `t_${slug}_${crypto.randomBytes(3).toString('hex')}`;
}

async function getCompany(client, companyId) {
  const r = await client.query('SELECT * FROM platform.companies WHERE id = $1', [companyId]);
  return r.rows[0] || null;
}

// ---------- Tenant table helpers ----------
function assertStore(store) {
  if (!TENANT_STORES.includes(store)) throw Object.assign(new Error(`Unknown store: ${store}`), { status: 400 });
}

async function tenantUpsert(client, schema, store, id, data) {
  assertStore(store);
  await client.query(
    `INSERT INTO ${ident(schema)}.${ident(store)} (id, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [String(id), data]
  );
}

async function tenantGet(client, schema, store, id) {
  assertStore(store);
  const r = await client.query(`SELECT data FROM ${ident(schema)}.${ident(store)} WHERE id = $1`, [String(id)]);
  return r.rows[0] ? r.rows[0].data : null;
}

async function tenantDelete(client, schema, store, id) {
  assertStore(store);
  await client.query(`DELETE FROM ${ident(schema)}.${ident(store)} WHERE id = $1`, [String(id)]);
}

async function tenantList(client, schema, store, { orderBy = 'id', limit = null } = {}) {
  assertStore(store);
  const order = orderBy === 'updated' ? 'updated_at' : 'id';
  const r = await client.query(`SELECT data FROM ${ident(schema)}.${ident(store)} ORDER BY ${order}${limit ? ` DESC LIMIT ${Number(limit)}` : ''}`);
  const rows = r.rows.map((x) => x.data);
  return limit ? rows.reverse() : rows;
}

// ---------- Provisioning ----------
// Creates the company row, its dedicated schema, the admin login, and starter workspace data.
async function provisionCompany(client, { registration, plan }) {
  const d = registration.data;
  const companyId = `tenant_${crypto.randomBytes(8).toString('hex')}`;
  const schema = makeSchemaName(d.companyName);
  const adminUserId = `user-admin-${crypto.randomBytes(6).toString('hex')}`;

  await client.query(
    `INSERT INTO platform.companies
       (id, name, domain, schema_name, admin_email, is_master_vip, plan, seats, billing_cycle,
        trial_used, trial_ends_at, paid_until, paid_at, license_key, last_transaction_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      companyId, d.companyName, d.companyDomain, schema, registration.email, plan.isMasterVIP,
      plan.name, plan.seats, plan.cycle, Boolean(plan.trialEndsAt), plan.trialEndsAt || null,
      plan.paidUntil || null, plan.paidUntil ? new Date() : null, plan.licenseKey || null, plan.transactionId || null,
    ]
  );

  await client.query(tenantSchemaSql(schema));

  await client.query(
    `INSERT INTO platform.accounts (user_id, company_id, email, password_hash, must_change_password, role)
     VALUES ($1, $2, $3, $4, false, 'Admin')`,
    [adminUserId, companyId, registration.email, registration.password_hash]
  );

  const team = {
    id: 'team-initial',
    name: d.initialTeam || 'Core Operations',
    leadId: adminUserId,
    desc: 'Primary departmental workspace.',
    emblem: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=150&auto=format&fit=crop&q=80',
  };
  const adminUser = {
    id: adminUserId,
    name: d.adminName,
    email: registration.email,
    role: 'Admin',
    teamId: team.id,
    isFloatingSupport: true,
    skills: ['System Administration', 'Governance', 'Operations'],
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  };
  const starterTask = {
    id: 'TSK-101',
    title: 'Invite your team and set up departments',
    desc: 'Add members from Teams & Cross-Support. Each member receives an email with a sign-in link and a temporary password.',
    teamId: team.id,
    assigneeId: adminUserId,
    status: 'In Progress',
    priority: 'High',
    dueDate: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    tags: ['Onboarding'],
    attachments: [],
  };

  await tenantUpsert(client, schema, 'teams', team.id, team);
  await tenantUpsert(client, schema, 'users', adminUser.id, adminUser);
  await tenantUpsert(client, schema, 'tasks', starterTask.id, starterTask);

  return { companyId, adminUserId, schema };
}

module.exports = {
  ROLES,
  DEFAULT_AVATAR,
  isMasterEmail,
  accessState,
  companyDTO,
  getCompany,
  tenantUpsert,
  tenantGet,
  tenantDelete,
  tenantList,
  provisionCompany,
};
