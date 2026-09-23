'use strict';

const crypto = require('crypto');
const { endpoint, HttpError, authenticate, issueSession, EMAIL_RE, cleanText } = require('./_lib/http');
const { query, tx, ident, literal } = require('./_lib/db');
const { encryptSecret, verifyPassword } = require('./_lib/security');
const { sendWith, companySmtpConfig, testEmail } = require('./_lib/mailer');
const {
  quote, createRazorpayOrder, verifyRazorpaySignature, periodEnd, publicBillingInfo,
} = require('./_lib/billing');
const { companyDTO, getCompany, accessState } = require('./_lib/company');
const { buildSnapshot } = require('./_lib/snapshot');

const TRIAL_DAYS = 14;

// Billing actions accept a full admin session, or the short-lived billing token issued at login when a subscription has lapsed.
const billingAuth = (req) => authenticate(req, { scopes: ['session', 'billing'], roles: ['Admin'], requireAccess: false });

async function activationResult(scope, account, companyId) {
  const company = await getCompany({ query }, companyId);
  if (scope === 'billing' && accessState(company).hasAccess) {
    return {
      company: companyDTO(company),
      token: issueSession(account.userId, company.id, account.tokenVersion),
      snapshot: await buildSnapshot(company, account.userId),
    };
  }
  return { company: companyDTO(company) };
}

function smtpView(company) {
  const s = company.smtp || {};
  return {
    configured: Boolean(s.host),
    host: s.host || '',
    port: s.port || 587,
    secure: Boolean(s.secure),
    user: s.user || '',
    fromName: s.fromName || '',
    fromEmail: s.fromEmail || '',
    hasPassword: Boolean(s.passEncrypted),
  };
}

// Connection details for a company's read-only database login.
function dbConnectionInfo(role, password) {
  const u = new URL(process.env.DATABASE_URL);
  const host = process.env.TENANT_DB_HOST || u.hostname;
  const port = process.env.TENANT_DB_PORT || u.port || '5432';
  const database = u.pathname.replace(/^\//, '') || 'postgres';
  // Supabase's pooler identifies the project through the username suffix (postgres.<project-ref>).
  const ref = decodeURIComponent(u.username).split('.')[1];
  const username = host.includes('pooler.supabase.com') && ref ? `${role}.${ref}` : role;
  const info = { host, port, database, username, sslmode: 'require' };
  if (password) {
    info.password = password;
    info.connectionString = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=require`;
  }
  return info;
}

module.exports = endpoint({
  settings: {
    method: 'GET',
    handler: async ({ req }) => {
      const { company } = await authenticate(req, { roles: ['Admin'] });
      return {
        smtp: smtpView(company),
        database: {
          schema: company.schema_name,
          enabled: Boolean(company.db_role),
          ...(company.db_role ? dbConnectionInfo(company.db_role) : {}),
          views: ['v_tasks', 'v_members', 'v_teams', 'v_daily_updates', 'v_audit_logs'],
        },
        billing: publicBillingInfo(),
      };
    },
  },

  'update-profile': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { company } = await authenticate(req, { roles: ['Admin'] });
      const name = body.name !== undefined ? cleanText(body.name, 80) : company.name;
      const domain = body.domain !== undefined ? cleanText(body.domain, 120) : company.domain;
      let logo = company.logo;
      if (body.logo !== undefined) {
        const l = String(body.logo || '');
        if (l && !/^https:\/\//.test(l) && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(l)) throw new HttpError(400, 'Unsupported logo format.');
        if (l.length > 600000) throw new HttpError(400, 'Logo image is too large.');
        logo = l || null;
      }
      if (!name) throw new HttpError(400, 'Company name is required.');
      await query('UPDATE platform.companies SET name = $2, domain = $3, logo = $4 WHERE id = $1', [company.id, name, domain, logo]);
      return { company: companyDTO(await getCompany({ query }, company.id)) };
    },
  },

  // ---------- Company SMTP ----------
  'save-smtp': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { company } = await authenticate(req, { roles: ['Admin'] });
      if (body.clear) {
        await query('UPDATE platform.companies SET smtp = NULL WHERE id = $1', [company.id]);
        return { smtp: smtpView({}) };
      }
      const host = cleanText(body.host, 200);
      const port = Number(body.port) || 587;
      const user = cleanText(body.user, 200);
      const fromEmail = String(body.fromEmail || '').trim().toLowerCase();
      if (!host || !user) throw new HttpError(400, 'SMTP host and username are required.');
      if (port < 1 || port > 65535) throw new HttpError(400, 'Invalid SMTP port.');
      if (fromEmail && !EMAIL_RE.test(fromEmail)) throw new HttpError(400, 'Invalid "from" email address.');

      const prev = company.smtp || {};
      const passEncrypted = body.pass ? encryptSecret(String(body.pass)) : prev.passEncrypted;
      if (!passEncrypted) throw new HttpError(400, 'SMTP password is required.');

      const smtp = { host, port, secure: Boolean(body.secure), user, passEncrypted, fromName: cleanText(body.fromName, 80), fromEmail };
      await query('UPDATE platform.companies SET smtp = $2 WHERE id = $1', [company.id, smtp]);
      return { smtp: smtpView({ smtp }) };
    },
  },

  'test-smtp': {
    method: 'POST',
    handler: async ({ req }) => {
      const { account, company } = await authenticate(req, { roles: ['Admin'] });
      const config = companySmtpConfig(company);
      if (!config) throw new HttpError(400, 'Save your SMTP settings first.');
      try {
        await sendWith(config, { to: account.email, ...testEmail({ companyName: company.name }) });
      } catch (err) {
        throw new HttpError(400, `SMTP test failed: ${err.message}`, 'SMTP_TEST_FAILED');
      }
      return { sentTo: account.email };
    },
  },

  // ---------- Company database access (read-only login scoped to the company's schema) ----------
  'db-credentials': {
    method: 'POST',
    handler: async ({ req }) => {
      const { company } = await authenticate(req, { roles: ['Admin'] });
      const schema = company.schema_name;
      const role = `${schema}_ro`;
      const password = crypto.randomBytes(18).toString('base64url');
      const s = ident(schema);
      const r = ident(role);

      await tx(async (client) => {
        const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
        if (exists.rowCount) {
          await client.query(`ALTER ROLE ${r} WITH LOGIN PASSWORD ${literal(password)}`);
        } else {
          await client.query(`CREATE ROLE ${r} WITH LOGIN NOINHERIT PASSWORD ${literal(password)} CONNECTION LIMIT 5`);
        }
        await client.query(`
          GRANT USAGE ON SCHEMA ${s} TO ${r};
          GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO ${r};
          ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT ON TABLES TO ${r};
          ALTER ROLE ${r} SET search_path = ${s};
          ALTER ROLE ${r} SET statement_timeout = '30s';`);
        await client.query('UPDATE platform.companies SET db_role = $2 WHERE id = $1', [company.id, role]);
      });

      return { database: { schema, enabled: true, ...dbConnectionInfo(role, password) } };
    },
  },

  'revoke-db-access': {
    method: 'POST',
    handler: async ({ req }) => {
      const { company } = await authenticate(req, { roles: ['Admin'] });
      if (company.db_role) {
        const r = ident(company.db_role);
        await query(`ALTER ROLE ${r} WITH NOLOGIN PASSWORD NULL`);
        await query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1`, [company.db_role]).catch(() => {});
        await query('UPDATE platform.companies SET db_role = NULL WHERE id = $1', [company.id]);
      }
      return { database: { schema: company.schema_name, enabled: false } };
    },
  },

  // ---------- Delete the whole organization ----------
  // Removes the company's schema (all workspace data), its database login and every member account.
  'delete-organization': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company } = await authenticate(req, { roles: ['Admin'], requireAccess: false });
      if (String(body.confirmName || '').trim().toLowerCase() !== String(company.name).trim().toLowerCase()) {
        throw new HttpError(400, 'Type the company name exactly as shown to confirm.', 'CONFIRM_MISMATCH');
      }
      const acct = (await query('SELECT password_hash FROM platform.accounts WHERE user_id = $1', [account.userId])).rows[0];
      if (!acct || !(await verifyPassword(String(body.password || ''), acct.password_hash))) {
        throw new HttpError(400, 'Your password is incorrect.', 'INVALID_PASSWORD');
      }

      const schema = ident(company.schema_name);
      await tx(async (client) => {
        // Lock the row so two admins can't race the deletion.
        await client.query('SELECT id FROM platform.companies WHERE id = $1 FOR UPDATE', [company.id]);
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.query('DELETE FROM platform.companies WHERE id = $1', [company.id]); // accounts cascade
      });

      // The read-only database login (if any) is removed after its schema is gone.
      if (company.db_role) {
        const r = ident(company.db_role);
        await query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1', [company.db_role]).catch(() => {});
        await query(`DROP ROLE IF EXISTS ${r}`).catch(async (err) => {
          console.error('[company] could not drop role, disabling instead', err.message);
          await query(`ALTER ROLE ${r} WITH NOLOGIN PASSWORD NULL`).catch(() => {});
        });
      }
      return { deleted: company.id };
    },
  },

  // ---------- Billing ----------
  'create-order': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company } = await billingAuth(req);
      const q = quote(body.seats, body.cycle);
      const order = await createRazorpayOrder({
        amount: q.amount,
        currency: q.currency,
        receipt: company.id,
        notes: { companyId: company.id, company: company.name, seats: String(q.seats), cycle: q.cycle },
      });
      await query(
        'UPDATE platform.companies SET pending_order_id = $2, pending_order_seats = $3, pending_order_cycle = $4 WHERE id = $1',
        [company.id, order.id, q.seats, q.cycle]
      );
      return {
        order: { id: order.id, amount: order.amount, currency: order.currency },
        keyId: process.env.RAZORPAY_KEY_ID,
        prefill: { email: account.email },
        companyName: company.name,
        seats: q.seats,
        cycle: q.cycle,
      };
    },
  },

  'confirm-payment': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company, scope } = await billingAuth(req);
      const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;

      await tx(async (client) => {
        const c = (await client.query('SELECT * FROM platform.companies WHERE id = $1 FOR UPDATE', [company.id])).rows[0];
        if (!c.pending_order_id || c.pending_order_id !== orderId) throw new HttpError(400, 'Payment does not match the pending order.');
        if (!verifyRazorpaySignature(orderId, paymentId, signature)) throw new HttpError(400, 'Payment verification failed.', 'PAYMENT_INVALID');

        const q = quote(c.pending_order_seats, c.pending_order_cycle);
        await client.query(
          `INSERT INTO platform.payments (id, order_id, company_id, amount, currency, seats, cycle, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'captured')`,
          [paymentId, orderId, c.id, q.amount, q.currency, q.seats, q.cycle]
        );
        // Renewals extend from the current end date when still active.
        const base = c.paid_until && new Date(c.paid_until) > new Date() ? new Date(c.paid_until) : new Date();
        await client.query(
          `UPDATE platform.companies
              SET paid_until = $2, paid_at = now(), seats = $3, billing_cycle = $4, plan = $5,
                  last_transaction_id = $6, pending_order_id = NULL, pending_order_seats = NULL, pending_order_cycle = NULL
            WHERE id = $1`,
          [c.id, periodEnd(q.cycle, base), q.seats, q.cycle,
            `Commercial Paid (${q.currency} ${q.perUser}/user/${q.cycle === 'yearly' ? 'yr' : 'mo'})`, paymentId]
        );
      });
      return activationResult(scope, account, company.id);
    },
  },

  'redeem-license': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company, scope } = await billingAuth(req);
      const key = String(body.licenseKey || '').trim().toUpperCase();
      await tx(async (client) => {
        const lic = (await client.query('SELECT * FROM platform.license_keys WHERE key = $1 FOR UPDATE', [key])).rows[0];
        if (!lic || lic.redeemed_by) throw new HttpError(400, 'This license key is invalid or has already been used.', 'LICENSE_INVALID');
        const until = lic.valid_days ? new Date(Date.now() + lic.valid_days * 86400000) : new Date('2999-12-31T00:00:00Z');
        await client.query(
          `UPDATE platform.companies SET paid_until = $2, paid_at = now(), seats = GREATEST(seats, $3), plan = $4, license_key = $5 WHERE id = $1`,
          [company.id, until, lic.seats, `Enterprise License (${key})`, key]
        );
        await client.query('UPDATE platform.license_keys SET redeemed_by = $2, redeemed_at = now() WHERE key = $1', [key, company.id]);
      });
      return activationResult(scope, account, company.id);
    },
  },

  // Bank transfers can't be verified automatically: we record the reference for the platform owner to confirm.
  'submit-wire': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { company } = await billingAuth(req);
      const reference = cleanText(body.reference, 80);
      if (reference.length < 4) throw new HttpError(400, 'Please enter your bank transfer / UTR reference number.');
      await query('UPDATE platform.companies SET pending_wire_reference = $2 WHERE id = $1', [company.id, reference]);
      return { company: companyDTO(await getCompany({ query }, company.id)) };
    },
  },

  'start-trial': {
    method: 'POST',
    handler: async ({ req }) => {
      const { account, company, scope } = await billingAuth(req);
      if (company.trial_used) throw new HttpError(400, 'The free trial has already been used for this company. Please subscribe to continue.', 'TRIAL_USED');
      await query(
        `UPDATE platform.companies SET trial_used = true, trial_ends_at = now() + interval '${TRIAL_DAYS} days', plan = 'Commercial 14-Day Free Trial' WHERE id = $1`,
        [company.id]
      );
      return activationResult(scope, account, company.id);
    },
  },
});
