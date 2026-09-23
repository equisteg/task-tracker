'use strict';

const crypto = require('crypto');
const { endpoint, HttpError, authenticate, appUrl, EMAIL_RE, cleanText } = require('./_lib/http');
const { query, tx } = require('./_lib/db');
const { hashPassword, generateTempPassword } = require('./_lib/security');
const { sendCompanyMail, inviteEmail } = require('./_lib/mailer');
const { ROLES, DEFAULT_AVATAR, tenantUpsert, tenantGet, tenantDelete } = require('./_lib/company');

function cleanSkills(skills) {
  return (Array.isArray(skills) ? skills : String(skills || '').split(','))
    .map((s) => cleanText(s, 40))
    .filter(Boolean)
    .slice(0, 20);
}

function cleanAvatar(avatar) {
  const a = String(avatar || '');
  if (/^https:\/\//.test(a) && a.length < 2000) return a;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(a) && a.length < 600000) return a;
  return null;
}

async function sendInvite(req, company, inviter, member, tempPassword) {
  const loginUrl = `${appUrl(req)}/?invite=${encodeURIComponent(member.email)}`;
  try {
    const { via } = await sendCompanyMail(company, {
      to: member.email,
      ...inviteEmail({
        memberName: member.name,
        companyName: company.name,
        invitedBy: inviter,
        email: member.email,
        tempPassword,
        loginUrl,
      }),
    });
    return { emailSent: true, via };
  } catch (err) {
    console.error('[members] invite email failed', err);
    // The admin created this credential; show it once so they can share it another way.
    return { emailSent: false, emailError: err.message, tempPassword, loginUrl };
  }
}

async function inviterName(company, userId) {
  const me = await tenantGet({ query }, company.schema_name, 'users', userId);
  return (me && me.name) || 'Your admin';
}

module.exports = endpoint({
  invite: {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company } = await authenticate(req, { roles: ['Admin'] });
      const email = String(body.email || '').trim().toLowerCase();
      const name = cleanText(body.name, 80);
      const role = ROLES.includes(body.role) ? body.role : 'TM';
      if (!name) throw new HttpError(400, 'Member name is required.');
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid member email is required.');

      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      const userId = `user-${crypto.randomBytes(6).toString('hex')}`;
      const member = {
        id: userId,
        name,
        email,
        role,
        teamId: cleanText(body.teamId, 80) || 'team-initial',
        isFloatingSupport: Boolean(body.isFloatingSupport),
        skills: cleanSkills(body.skills),
        avatar: cleanAvatar(body.avatar) || DEFAULT_AVATAR,
      };

      await tx(async (client) => {
        // Serialise invites per company so the seat check can't be raced.
        await client.query('SELECT id FROM platform.companies WHERE id = $1 FOR UPDATE', [company.id]);
        if (!company.is_master_vip) {
          const count = await client.query('SELECT count(*)::int AS n FROM platform.accounts WHERE company_id = $1', [company.id]);
          if (count.rows[0].n >= company.seats) {
            throw new HttpError(402, `All ${company.seats} seats are in use. Increase your seat count under Subscription to add more members.`, 'SEATS_EXHAUSTED');
          }
        }
        const exists = await client.query('SELECT 1 FROM platform.accounts WHERE email = $1', [email]);
        if (exists.rowCount) throw new HttpError(409, 'A user with this email already exists.', 'EMAIL_TAKEN');
        await client.query(
          `INSERT INTO platform.accounts (user_id, company_id, email, password_hash, must_change_password, role, invited_at)
           VALUES ($1, $2, $3, $4, true, $5, now())`,
          [userId, company.id, email, passwordHash, role]
        );
        await tenantUpsert(client, company.schema_name, 'users', userId, member);
      });

      const mail = await sendInvite(req, company, await inviterName(company, account.userId), member, tempPassword);
      return { user: { ...member, inviteStatus: 'pending' }, ...mail };
    },
  },

  'resend-invite': {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company } = await authenticate(req, { roles: ['Admin'] });
      const r = await query('SELECT * FROM platform.accounts WHERE user_id = $1 AND company_id = $2', [String(body.userId || ''), company.id]);
      const target = r.rows[0];
      if (!target) throw new HttpError(404, 'Member not found.');
      if (!target.must_change_password) throw new HttpError(400, 'This member has already set their password.');

      const tempPassword = generateTempPassword();
      await query(
        `UPDATE platform.accounts
            SET password_hash = $2, token_version = token_version + 1, invited_at = now(), failed_attempts = 0, locked_until = NULL
          WHERE user_id = $1`,
        [target.user_id, await hashPassword(tempPassword)]
      );
      const profile = (await tenantGet({ query }, company.schema_name, 'users', target.user_id)) || { name: target.email };
      const mail = await sendInvite(req, company, await inviterName(company, account.userId), { ...profile, email: target.email }, tempPassword);
      return mail;
    },
  },

  update: {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company } = await authenticate(req);
      const userId = String(body.userId || '');
      const isAdmin = account.role === 'Admin';
      if (!isAdmin && userId !== account.userId) throw new HttpError(403, 'Only admins can edit other members.', 'FORBIDDEN');

      const user = await tx(async (client) => {
        const current = await tenantGet(client, company.schema_name, 'users', userId);
        if (!current) throw new HttpError(404, 'Member not found.');
        const next = { ...current };
        if (body.name !== undefined) next.name = cleanText(body.name, 80) || current.name;
        if (body.skills !== undefined) next.skills = cleanSkills(body.skills);
        if (body.avatar) next.avatar = cleanAvatar(body.avatar) || current.avatar;

        if (isAdmin) {
          if (body.teamId !== undefined) next.teamId = cleanText(body.teamId, 80);
          if (body.isFloatingSupport !== undefined) next.isFloatingSupport = Boolean(body.isFloatingSupport);
          if (body.role !== undefined && ROLES.includes(body.role) && body.role !== current.role) {
            if (current.role === 'Admin') {
              const admins = await client.query("SELECT count(*)::int AS n FROM platform.accounts WHERE company_id = $1 AND role = 'Admin'", [company.id]);
              if (admins.rows[0].n <= 1) throw new HttpError(400, 'A company must keep at least one Admin.');
            }
            next.role = body.role;
            await client.query('UPDATE platform.accounts SET role = $3 WHERE user_id = $1 AND company_id = $2', [userId, company.id, body.role]);
          }
        }
        await tenantUpsert(client, company.schema_name, 'users', userId, next);
        return next;
      });
      return { user };
    },
  },

  delete: {
    method: 'POST',
    handler: async ({ req, body }) => {
      const { account, company } = await authenticate(req, { roles: ['Admin'] });
      const userId = String(body.userId || '');
      if (userId === account.userId) throw new HttpError(400, "You can't delete your own account.");
      await tx(async (client) => {
        await client.query('DELETE FROM platform.accounts WHERE user_id = $1 AND company_id = $2', [userId, company.id]);
        await tenantDelete(client, company.schema_name, 'users', userId);
      });
      return { deleted: userId };
    },
  },
});
