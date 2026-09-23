'use strict';

const { nodemailer } = require('./vendor');
const { decryptSecret } = require('./security');

function platformSmtpConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT) || 587;
  return {
    host: SMTP_HOST,
    port,
    secure: SMTP_SECURE ? SMTP_SECURE === 'true' : port === 465,
    user: SMTP_USER,
    pass: SMTP_PASS,
    from: SMTP_FROM || SMTP_USER,
  };
}

// Company SMTP settings are stored with the password encrypted at rest.
function companySmtpConfig(company) {
  const s = company && company.smtp;
  if (!s || !s.host || !s.user || !s.passEncrypted) return null;
  return {
    host: s.host,
    port: Number(s.port) || 587,
    secure: Boolean(s.secure),
    user: s.user,
    pass: decryptSecret(s.passEncrypted),
    from: s.fromEmail ? (s.fromName ? `"${s.fromName.replace(/"/g, '')}" <${s.fromEmail}>` : s.fromEmail) : s.user,
  };
}

async function sendWith(config, message) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transport.sendMail({ from: config.from, ...message });
}

// Registration OTPs always go through the platform mailbox (the company doesn't exist yet).
async function sendPlatformMail(message) {
  const config = platformSmtpConfig();
  if (!config) {
    throw Object.assign(new Error('Platform SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS).'), { status: 500, code: 'SMTP_NOT_CONFIGURED' });
  }
  await sendWith(config, message);
  return { via: 'platform' };
}

// Company mail uses the company's own SMTP when configured, otherwise the platform SMTP.
async function sendCompanyMail(company, message) {
  const own = companySmtpConfig(company);
  if (own) {
    await sendWith(own, message);
    return { via: 'company' };
  }
  const platform = platformSmtpConfig();
  if (!platform) {
    throw Object.assign(new Error('No SMTP configured. Add your company SMTP in Settings, or configure platform SMTP.'), { status: 500, code: 'SMTP_NOT_CONFIGURED' });
  }
  const from = platform.from.includes('<') ? platform.from : `"${String(company.name).replace(/"/g, '')} via Task Tracker" <${platform.from}>`;
  await sendWith({ ...platform, from }, message);
  return { via: 'platform' };
}

// ---------- Templates ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
    <h2 style="margin:0 0 16px;font-size:20px">${esc(title)}</h2>
    ${bodyHtml}
    <p style="margin-top:28px;font-size:12px;color:#64748b">If you did not expect this email, you can safely ignore it.</p>
  </div></body></html>`;
}

function otpEmail({ adminName, companyName, code }) {
  return {
    subject: `${code} is your verification code for ${companyName}`,
    text: `Hi ${adminName},\n\nYour verification code for registering ${companyName} is: ${code}\n\nThe code expires in 10 minutes.`,
    html: layout('Verify your email', `
      <p>Hi ${esc(adminName)},</p>
      <p>Use this code to verify your email and finish registering <strong>${esc(companyName)}</strong>:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;font-family:Consolas,monospace;background:#ecfdf5;color:#047857;padding:14px;text-align:center;border-radius:10px">${esc(code)}</p>
      <p style="font-size:13px;color:#475569">The code expires in 10 minutes.</p>`),
  };
}

function inviteEmail({ memberName, companyName, invitedBy, email, tempPassword, loginUrl }) {
  return {
    subject: `You've been added to ${companyName} on Task Tracker`,
    text: `Hi ${memberName},\n\n${invitedBy} added you to ${companyName}.\n\nSign in: ${loginUrl}\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nYou will be asked to set a new password when you first sign in. You can't use the workspace until you change it.`,
    html: layout(`Welcome to ${companyName}`, `
      <p>Hi ${esc(memberName)},</p>
      <p><strong>${esc(invitedBy)}</strong> added you to the <strong>${esc(companyName)}</strong> workspace.</p>
      <table style="width:100%;font-size:14px;background:#f8fafc;border-radius:10px;padding:12px;margin:12px 0">
        <tr><td style="color:#64748b;padding:4px 8px">Email</td><td style="padding:4px 8px"><strong>${esc(email)}</strong></td></tr>
        <tr><td style="color:#64748b;padding:4px 8px">Temporary password</td><td style="padding:4px 8px;font-family:Consolas,monospace"><strong>${esc(tempPassword)}</strong></td></tr>
      </table>
      <p style="text-align:center;margin:22px 0"><a href="${esc(loginUrl)}" style="background:#059669;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Sign in to ${esc(companyName)}</a></p>
      <p style="font-size:13px;color:#475569">When you first sign in you'll be asked to set your own password. You can't use the workspace until you change it.</p>`),
  };
}

function testEmail({ companyName }) {
  return {
    subject: `SMTP test for ${companyName}`,
    text: `Your SMTP settings for ${companyName} work.`,
    html: layout('SMTP settings verified', `<p>Your SMTP settings for <strong>${esc(companyName)}</strong> work. Member invites will be sent from this mailbox.</p>`),
  };
}

module.exports = {
  sendPlatformMail,
  sendCompanyMail,
  sendWith,
  platformSmtpConfig,
  companySmtpConfig,
  otpEmail,
  inviteEmail,
  testEmail,
};
