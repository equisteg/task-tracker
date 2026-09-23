'use strict';

const { endpoint, HttpError, authenticate, issueSession } = require('./_lib/http');
const { query } = require('./_lib/db');
const {
  verifyPassword, hashPassword, validatePasswordStrength, signToken, verifyToken,
  generateOtp, hashOtp, safeEqualHex, randomId,
} = require('./_lib/security');
const { accessState, companyDTO, getCompany, tenantGet } = require('./_lib/company');
const { sendCompanyMail, resetEmail } = require('./_lib/mailer');
const { EMAIL_RE } = require('./_lib/http');
const { buildSnapshot } = require('./_lib/snapshot');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 10;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_SECONDS = 60;
const RESET_MAX_PER_HOUR = 5;

async function emailResetCode(account, resetId) {
  const code = generateOtp();
  await query(
    `UPDATE platform.password_resets
        SET otp_hash = $2, expires_at = now() + interval '${RESET_TTL_MIN} minutes', attempts = 0, sent_at = now()
      WHERE id = $1`,
    [resetId, hashOtp(resetId, code)]
  );
  const company = await getCompany({ query }, account.company_id);
  const profile = await tenantGet({ query }, company.schema_name, 'users', account.user_id).catch(() => null);
  await sendCompanyMail(company, {
    to: account.email,
    ...resetEmail({ name: (profile && profile.name) || account.email, companyName: company.name, code }),
  });
}

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

  // ---------- Forgot password (email OTP) ----------
  // Responds the same way whether or not the email has an account, so it can't be used to discover accounts.
  'forgot-password': {
    method: 'POST',
    handler: async ({ body }) => {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      const result = { resetId: randomId('rst_'), resendAfterSeconds: RESET_RESEND_SECONDS };

      const account = (await query('SELECT * FROM platform.accounts WHERE email = $1', [email])).rows[0];
      if (!account) return result;

      const recent = (await query(
        `SELECT count(*)::int AS n, max(created_at) AS last FROM platform.password_resets
          WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
        [account.user_id]
      )).rows[0];
      if (recent.n >= RESET_MAX_PER_HOUR) throw new HttpError(429, 'Too many reset requests. Please try again in an hour.');
      if (recent.last && Date.now() - new Date(recent.last).getTime() < RESET_RESEND_SECONDS * 1000) {
        throw new HttpError(429, 'Please wait a minute before requesting another code.');
      }

      // Only the newest code is valid.
      await query('UPDATE platform.password_resets SET used = true WHERE user_id = $1 AND NOT used', [account.user_id]);
      await query(
        `INSERT INTO platform.password_resets (id, user_id, otp_hash, expires_at) VALUES ($1, $2, '', now())`,
        [result.resetId, account.user_id]
      );
      try {
        await emailResetCode(account, result.resetId);
      } catch (err) {
        console.error('[auth] reset email failed', err);
        throw new HttpError(502, "We couldn't send the reset email right now. Please try again shortly.", 'EMAIL_SEND_FAILED');
      }
      return result;
    },
  },

  'verify-reset-code': {
    method: 'POST',
    handler: async ({ body }) => {
      const invalid = new HttpError(400, 'That code is incorrect or has expired.', 'RESET_CODE_INVALID');
      const reset = (await query(
        `SELECT r.*, a.token_version, a.company_id FROM platform.password_resets r
           JOIN platform.accounts a ON a.user_id = r.user_id
          WHERE r.id = $1 AND NOT r.used`,
        [String(body.resetId || '')]
      )).rows[0];
      if (!reset) throw invalid;
      if (reset.attempts >= RESET_MAX_ATTEMPTS) throw new HttpError(429, 'Too many incorrect attempts. Request a new code.', 'RESET_LOCKED');
      if (new Date(reset.expires_at).getTime() < Date.now()) throw new HttpError(400, 'This code has expired. Request a new code.', 'RESET_CODE_EXPIRED');
      const code = String(body.code || '').trim();
      if (!/^\d{6}$/.test(code) || !safeEqualHex(hashOtp(reset.id, code), reset.otp_hash)) {
        await query('UPDATE platform.password_resets SET attempts = attempts + 1 WHERE id = $1', [reset.id]);
        throw invalid;
      }
      await query('UPDATE platform.password_resets SET verified = true WHERE id = $1', [reset.id]);
      return {
        resetToken: signToken({ sub: reset.user_id, cid: reset.company_id, tv: reset.token_version, rid: reset.id, scope: 'reset' }, 15 * 60),
      };
    },
  },

  'reset-password': {
    method: 'POST',
    handler: async ({ body }) => {
      const expired = new HttpError(401, 'This reset session has expired. Please start again.', 'RESET_EXPIRED');
      const payload = verifyToken(String(body.resetToken || ''), 'reset');
      if (!payload) throw expired;
      const row = (await query(
        `SELECT a.* FROM platform.password_resets r JOIN platform.accounts a ON a.user_id = r.user_id
          WHERE r.id = $1 AND r.user_id = $2 AND r.verified AND NOT r.used`,
        [payload.rid, payload.sub]
      )).rows[0];
      if (!row || row.token_version !== payload.tv) throw expired;

      const newPassword = String(body.newPassword || '');
      const weak = validatePasswordStrength(newPassword);
      if (weak) throw new HttpError(400, weak);
      if (await verifyPassword(newPassword, row.password_hash)) throw new HttpError(400, 'Choose a password different from your current one.');

      // New password, other sessions signed out, lockout cleared, and codes can't be reused.
      const upd = await query(
        `UPDATE platform.accounts
            SET password_hash = $2, must_change_password = false, token_version = token_version + 1,
                failed_attempts = 0, locked_until = NULL
          WHERE user_id = $1 RETURNING *`,
        [row.user_id, await hashPassword(newPassword)]
      );
      await query('UPDATE platform.password_resets SET used = true WHERE user_id = $1', [row.user_id]);
      const company = await getCompany({ query }, upd.rows[0].company_id);
      return { passwordReset: true, ...(await sessionOrPaywall(upd.rows[0], company)) };
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
