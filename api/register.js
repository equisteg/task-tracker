'use strict';

const { endpoint, HttpError, issueSession, EMAIL_RE, cleanText } = require('./_lib/http');
const { query, tx } = require('./_lib/db');
const {
  hashPassword, validatePasswordStrength, generateOtp, hashOtp, safeEqualHex, randomId,
} = require('./_lib/security');
const { sendPlatformMail, otpEmail } = require('./_lib/mailer');
const { quote, createRazorpayOrder, verifyRazorpaySignature, periodEnd, normalizePlan } = require('./_lib/billing');
const { isMasterEmail, provisionCompany, getCompany } = require('./_lib/company');
const { buildSnapshot } = require('./_lib/snapshot');

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 5;
const REGISTRATION_TTL = "interval '24 hours'";
const TRIAL_DAYS = 14;

async function emailTaken(email) {
  const r = await query('SELECT 1 FROM platform.accounts WHERE email = $1', [email]);
  return r.rowCount > 0;
}

async function loadRegistration(id, { lock = false, client = null } = {}) {
  const runner = client || { query };
  const r = await runner.query(
    `SELECT * FROM platform.registrations WHERE id = $1 AND created_at > now() - ${REGISTRATION_TTL}${lock ? ' FOR UPDATE' : ''}`,
    [String(id || '')]
  );
  const reg = r.rows[0];
  if (!reg) throw new HttpError(404, 'Registration session expired. Please start again.', 'REGISTRATION_EXPIRED');
  if (reg.completed) throw new HttpError(409, 'This registration is already complete. Please sign in.', 'REGISTRATION_COMPLETED');
  return reg;
}

async function sendOtp(reg) {
  const code = generateOtp();
  await query(
    `UPDATE platform.registrations
        SET otp_hash = $2, otp_expires_at = now() + interval '10 minutes', otp_attempts = 0,
            otp_sends = otp_sends + 1, otp_sent_at = now()
      WHERE id = $1`,
    [reg.id, hashOtp(reg.id, code)]
  );
  await sendPlatformMail({ to: reg.email, ...otpEmail({ adminName: reg.data.adminName, companyName: reg.data.companyName, code }) });
}

module.exports = endpoint({
  'send-otp': {
    method: 'POST',
    handler: async ({ body }) => {
      const data = {
        companyName: cleanText(body.companyName, 80),
        companyDomain: cleanText(body.companyDomain, 120).toLowerCase(),
        adminName: cleanText(body.adminName, 80),
        initialTeam: cleanText(body.initialTeam, 60) || 'Core Operations',
      };
      const email = String(body.adminEmail || '').trim().toLowerCase();
      if (!data.companyName || !data.companyDomain || !data.adminName || !email || !body.password) {
        throw new HttpError(400, 'Please fill in all required registration fields.');
      }
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please provide a valid email address.');
      const weak = validatePasswordStrength(body.password);
      if (weak) throw new HttpError(400, weak);
      if (await emailTaken(email)) {
        throw new HttpError(409, 'An account with this email already exists. Please sign in instead.', 'EMAIL_TAKEN');
      }

      const reg = {
        id: randomId('reg_'),
        email,
        data,
        password_hash: await hashPassword(String(body.password)),
      };
      await query(
        'INSERT INTO platform.registrations (id, email, data, password_hash) VALUES ($1, $2, $3, $4)',
        [reg.id, reg.email, reg.data, reg.password_hash]
      );
      try {
        await sendOtp(reg);
      } catch (err) {
        await query('DELETE FROM platform.registrations WHERE id = $1', [reg.id]);
        console.error('[register] OTP email failed', err);
        throw new HttpError(502, `We couldn't send the verification email to ${email}. ${err.code === 'SMTP_NOT_CONFIGURED' ? err.message : 'Please check the address and try again.'}`, 'EMAIL_SEND_FAILED');
      }
      return { registrationId: reg.id, email, resendAfterSeconds: RESEND_COOLDOWN_MS / 1000, expiresInSeconds: OTP_TTL_MS / 1000 };
    },
  },

  'resend-otp': {
    method: 'POST',
    handler: async ({ body }) => {
      const reg = await loadRegistration(body.registrationId);
      if (reg.email_verified) return { alreadyVerified: true };
      if (reg.otp_sends >= MAX_SENDS) throw new HttpError(429, 'Too many codes requested. Please start the registration again.');
      const wait = reg.otp_sent_at ? RESEND_COOLDOWN_MS - (Date.now() - new Date(reg.otp_sent_at).getTime()) : 0;
      if (wait > 0) throw new HttpError(429, `Please wait ${Math.ceil(wait / 1000)}s before requesting a new code.`);
      try {
        await sendOtp(reg);
      } catch (err) {
        console.error('[register] OTP resend failed', err);
        throw new HttpError(502, "We couldn't send the verification email. Please try again shortly.", 'EMAIL_SEND_FAILED');
      }
      return { resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
    },
  },

  'verify-otp': {
    method: 'POST',
    handler: async ({ body }) => {
      const reg = await loadRegistration(body.registrationId);
      if (!reg.email_verified) {
        if (reg.otp_attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many incorrect attempts. Request a new code.');
        if (!reg.otp_expires_at || new Date(reg.otp_expires_at).getTime() < Date.now()) {
          throw new HttpError(400, 'This code has expired. Request a new code.', 'OTP_EXPIRED');
        }
        const code = String(body.code || '').trim();
        if (!/^\d{6}$/.test(code) || !safeEqualHex(hashOtp(reg.id, code), reg.otp_hash)) {
          await query('UPDATE platform.registrations SET otp_attempts = otp_attempts + 1 WHERE id = $1', [reg.id]);
          const left = MAX_ATTEMPTS - reg.otp_attempts - 1;
          throw new HttpError(400, `Incorrect code. ${left > 0 ? `${left} attempt(s) left.` : 'Request a new code.'}`, 'OTP_INVALID');
        }
        await query('UPDATE platform.registrations SET email_verified = true, otp_hash = NULL WHERE id = $1', [reg.id]);
      }
      return { verified: true, isMasterVIP: isMasterEmail(reg.email) };
    },
  },

  'create-order': {
    method: 'POST',
    handler: async ({ body }) => {
      const reg = await loadRegistration(body.registrationId);
      if (!reg.email_verified) throw new HttpError(403, 'Verify your email first.');
      const q = quote(body.seats, body.cycle);
      const order = await createRazorpayOrder({
        amount: q.amount,
        currency: q.currency,
        receipt: reg.id,
        notes: { registrationId: reg.id, company: reg.data.companyName, seats: String(q.seats), cycle: q.cycle },
      });
      await query(
        'UPDATE platform.registrations SET razorpay_order_id = $2, order_seats = $3, order_cycle = $4 WHERE id = $1',
        [reg.id, order.id, q.seats, q.cycle]
      );
      return {
        order: { id: order.id, amount: order.amount, currency: order.currency },
        keyId: process.env.RAZORPAY_KEY_ID,
        prefill: { name: reg.data.adminName, email: reg.email },
        companyName: reg.data.companyName,
        seats: q.seats,
        cycle: q.cycle,
      };
    },
  },

  complete: {
    method: 'POST',
    handler: async ({ body }) => {
      const mode = String(body.mode || '');
      const result = await tx(async (client) => {
        const reg = await loadRegistration(body.registrationId, { lock: true, client });
        if (!reg.email_verified) throw new HttpError(403, 'Verify your email first.');
        const taken = await client.query('SELECT 1 FROM platform.accounts WHERE email = $1', [reg.email]);
        if (taken.rowCount) throw new HttpError(409, 'An account with this email already exists. Please sign in instead.', 'EMAIL_TAKEN');

        let plan;
        if (mode === 'master') {
          if (!isMasterEmail(reg.email)) throw new HttpError(403, 'This email is not eligible for master access.');
          plan = { isMasterVIP: true, name: 'Master Lifetime Free Enterprise', seats: 999999, cycle: 'monthly' };
        } else if (mode === 'trial') {
          const p = normalizePlan(body.seats || 5, body.cycle);
          plan = {
            isMasterVIP: false, name: 'Commercial 14-Day Free Trial', seats: p.seats, cycle: p.cycle,
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000),
          };
        } else if (mode === 'paid') {
          const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
          if (!reg.razorpay_order_id || orderId !== reg.razorpay_order_id) throw new HttpError(400, 'Payment does not match this registration.');
          if (!verifyRazorpaySignature(orderId, paymentId, signature)) throw new HttpError(400, 'Payment verification failed.', 'PAYMENT_INVALID');
          const q = quote(reg.order_seats, reg.order_cycle);
          await client.query(
            `INSERT INTO platform.payments (id, order_id, registration_id, amount, currency, seats, cycle, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'captured')`,
            [paymentId, orderId, reg.id, q.amount, q.currency, q.seats, q.cycle]
          );
          plan = {
            isMasterVIP: false, name: `Commercial Paid (${q.currency} ${q.perUser}/user/${q.cycle === 'yearly' ? 'yr' : 'mo'})`,
            seats: q.seats, cycle: q.cycle, paidUntil: periodEnd(q.cycle), transactionId: paymentId,
          };
        } else if (mode === 'license') {
          const key = String(body.licenseKey || '').trim().toUpperCase();
          const lk = await client.query('SELECT * FROM platform.license_keys WHERE key = $1 FOR UPDATE', [key]);
          const lic = lk.rows[0];
          if (!lic || lic.redeemed_by) throw new HttpError(400, 'This license key is invalid or has already been used.', 'LICENSE_INVALID');
          plan = {
            isMasterVIP: false, name: `Enterprise License (${key})`, seats: lic.seats, cycle: 'yearly',
            paidUntil: lic.valid_days ? new Date(Date.now() + lic.valid_days * 86400000) : new Date('2999-12-31T00:00:00Z'),
            licenseKey: key,
          };
        } else {
          throw new HttpError(400, 'Choose a plan: free trial, payment, or license key.');
        }

        const { companyId, adminUserId } = await provisionCompany(client, { registration: reg, plan });
        if (mode === 'paid') await client.query('UPDATE platform.payments SET company_id = $2 WHERE id = $1', [body.razorpay_payment_id, companyId]);
        if (mode === 'license') {
          await client.query('UPDATE platform.license_keys SET redeemed_by = $2, redeemed_at = now() WHERE key = $1', [plan.licenseKey, companyId]);
        }
        await client.query('UPDATE platform.registrations SET completed = true, password_hash = \'\' WHERE id = $1', [reg.id]);
        await client.query('UPDATE platform.accounts SET last_login_at = now() WHERE user_id = $1', [adminUserId]);
        return { companyId, adminUserId };
      });

      const company = await getCompany({ query }, result.companyId);
      return {
        token: issueSession(result.adminUserId, result.companyId, 0),
        snapshot: await buildSnapshot(company, result.adminUserId),
      };
    },
  },
});
