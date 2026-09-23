'use strict';

const { endpoint, HttpError, authenticate, issueSession } = require('./_lib/http');
const { query } = require('./_lib/db');
const { verifyPassword, hashPassword, validatePasswordStrength, signToken } = require('./_lib/security');
const { accessState, companyDTO, getCompany } = require('./_lib/company');
const { buildSnapshot } = require('./_lib/snapshot');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// After credentials are proven: either a full session, or a billing-only token for an expired company.
async function sessionOrPaywall(account, company) {
  if (!accessState(company).hasAccess) {
    if (account.role === 'Admin') {
      throw new HttpError(402, `The subscription for ${company.name} has ended. Renew it to continue.`, 'PAYMENT_REQUIRED', {
        paymentToken: signToken({ sub: account.user_id, cid: company.id, tv: account.token_version, scope: 'billing' }, 30 * 60),
        company: companyDTO(company),
      });
    }
    throw new HttpError(402, `The subscription for ${company.name} has ended. Please ask your company admin to renew it.`, 'PAYMENT_REQUIRED');
  }
  await query('UPDATE platform.accounts SET last_login_at = now() WHERE user_id = $1', [account.user_id]);
  return {
    token: issueSession(account.user_id, company.id, account.token_version),
    snapshot: await buildSnapshot(company, account.user_id),
  };
}

module.exports = endpoint({
  login: {
    method: 'POST',
    handler: async ({ body }) => {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) throw new HttpError(400, 'Email and password are required.');

      const r = await query('SELECT * FROM platform.accounts WHERE email = $1', [email]);
      const account = r.rows[0];
      const invalid = new HttpError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
      if (!account) throw invalid;

      if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
        const mins = Math.ceil((new Date(account.locked_until).getTime() - Date.now()) / 60000);
        throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute(s).`, 'LOCKED');
      }

      if (!(await verifyPassword(password, account.password_hash))) {
        await query(
          `UPDATE platform.accounts
              SET failed_attempts = failed_attempts + 1,
                  locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END
            WHERE user_id = $1`,
          [account.user_id, MAX_FAILED]
        );
        throw invalid;
      }
      await query('UPDATE platform.accounts SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1', [account.user_id]);

      if (account.must_change_password) {
        return {
          requiresPasswordChange: true,
          changeToken: signToken({ sub: account.user_id, cid: account.company_id, tv: account.token_version, scope: 'change_password' }, 15 * 60),
        };
      }

      const company = await getCompany({ query }, account.company_id);
      return sessionOrPaywall(account, company);
    },
  },

  // Used both for the mandatory first-login change (change_password token) and voluntary changes (session token).
  'change-password': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, scope } = await authenticate(req, { scopes: ['change_password', 'session'], requireAccess: false });
      const r = await query('SELECT * FROM platform.accounts WHERE user_id = $1', [account.userId]);
      const row = r.rows[0];
      const newPassword = String(body.newPassword || '');

      if (scope === 'session' && !(await verifyPassword(String(body.currentPassword || ''), row.password_hash))) {
        throw new HttpError(400, 'Your current password is incorrect.');
      }
      const weak = validatePasswordStrength(newPassword);
      if (weak) throw new HttpError(400, weak);
      if (await verifyPassword(newPassword, row.password_hash)) {
        throw new HttpError(400, 'Choose a password different from your current / temporary password.');
      }

      const upd = await query(
        `UPDATE platform.accounts
            SET password_hash = $2, must_change_password = false, token_version = token_version + 1
          WHERE user_id = $1 RETURNING *`,
        [account.userId, await hashPassword(newPassword)]
      );
      const company = await getCompany({ query }, upd.rows[0].company_id);
      return { passwordChanged: true, ...(await sessionOrPaywall(upd.rows[0], company)) };
    },
  },
});
