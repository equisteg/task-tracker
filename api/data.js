'use strict';

const { endpoint, HttpError, authenticate, cleanText } = require('./_lib/http');
const { tx, ident } = require('./_lib/db');
const { tenantUpsert, tenantDelete } = require('./_lib/company');
const { buildSnapshot } = require('./_lib/snapshot');

const MAX_OPS = 200;
const MAX_ITEM_BYTES = 2 * 1024 * 1024;
const WRITERS = ['Admin', 'Lead', 'TM', 'Support'];

// Who may write each synced store. Users & company billing are managed only through /api/members and /api/company.
const POLICY = {
  tasks: { put: WRITERS, delete: WRITERS },
  daily_updates: { put: WRITERS, delete: WRITERS },
  teams: { put: ['Admin', 'Lead'], delete: ['Admin'] },
  settings: { put: ['Admin'], delete: ['Admin'] },
  audit_logs: { put: ['Admin', 'Lead', 'TM', 'Support', 'Auditor'], delete: [] },
  company: { put: ['Admin'], delete: [] },
};

function itemId(store, op) {
  const raw = store === 'settings' ? (op.item && op.item.key) || op.id : op.item ? op.item.id : op.id;
  const id = raw == null ? '' : String(raw);
  if (!id || id.length > 200) throw new HttpError(400, `Missing or invalid id for ${store}.`);
  return id;
}

async function applyOp(client, account, company, op) {
  const store = String(op.store || '');
  const policy = POLICY[store];
  if (!policy) return { skipped: true, reason: `${store} is managed by the server` };
  const allowed = op.op === 'delete' ? policy.delete : policy.put;
  if (!allowed.includes(account.role)) return { skipped: true, reason: `${account.role} cannot modify ${store}` };

  if (store === 'company') {
    const item = op.item || {};
    await client.query(
      'UPDATE platform.companies SET name = COALESCE($2, name), domain = COALESCE($3, domain), logo = COALESCE($4, logo) WHERE id = $1',
      [company.id, cleanText(item.name, 80) || null, cleanText(item.domain, 120) || null, typeof item.logo === 'string' && item.logo.length < 600000 ? item.logo : null]
    );
    return { ok: true };
  }

  const id = itemId(store, op);
  if (op.op === 'delete') {
    await tenantDelete(client, company.schema_name, store, id);
    return { ok: true };
  }
  if (op.op !== 'put' || !op.item || typeof op.item !== 'object') throw new HttpError(400, 'Invalid sync operation.');
  if (Buffer.byteLength(JSON.stringify(op.item)) > MAX_ITEM_BYTES) return { skipped: true, reason: 'Item too large (max 2 MB)' };

  if (store === 'audit_logs' && account.role !== 'Admin') {
    // Non-admins may append to the ledger but never rewrite existing entries.
    await client.query(
      `INSERT INTO ${ident(company.schema_name)}.audit_logs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, op.item]
    );
    return { ok: true };
  }
  await tenantUpsert(client, company.schema_name, store, id, op.item);
  return { ok: true };
}

module.exports = endpoint({
  get: {
    method: 'GET',
    handler: async ({ req }) => {
      const { account, company } = await authenticate(req);
      return { snapshot: await buildSnapshot(company, account.userId) };
    },
  },

  sync: {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company } = await authenticate(req);
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (ops.length > MAX_OPS) throw new HttpError(400, `Too many operations (max ${MAX_OPS}).`);
      const results = await tx(async (client) => {
        const out = [];
        for (const op of ops) out.push(await applyOp(client, account, company, op));
        return out;
      });
      return { results };
    },
  },
});
