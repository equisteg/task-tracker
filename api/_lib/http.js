'use strict';

const { verifyToken, signToken } = require('./security');
const { query } = require('./db');
const { accessState } = require('./company');

const SESSION_TTL = 7 * 24 * 3600;

class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body || '{}')); } catch (e) { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); }
    });
  });
}

// Wraps an endpoint: parses JSON, dispatches on `action`, maps errors to JSON responses.
function endpoint(actions) {
  return async (req, res) => {
    try {
      const body = req.method === 'GET' ? {} : await readBody(req);
      const url = new URL(req.url, 'http://localhost');
      const action = body.action || url.searchParams.get('action') || (req.method === 'GET' ? 'get' : '');
      const spec = actions[action];
      if (!spec) throw new HttpError(404, `Unknown action: ${action || '(none)'}`);
      if (spec.method && spec.method !== req.method) throw new HttpError(405, `Use ${spec.method} for ${action}`);
      const result = await spec.handler({ req, body, query: url.searchParams });
      send(res, 200, { ok: true, ...(result || {}) });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[api]', err);
      send(res, status, {
        ok: false,
        error: status >= 500 && !err.code ? 'Internal server error' : err.message,
        code: err.code || null,
        ...(err.extra || {}),
      });
    }
  };
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Loads the calling account + company from a signed token and checks it is still valid.
async function authenticate(req, { scopes = ['session'], requireAccess = true, roles = null } = {}) {
  const payload = verifyToken(bearer(req), scopes);
  if (!payload) throw new HttpError(401, 'Your session has expired. Please sign in again.', 'UNAUTHENTICATED');

  const r = await query(
    `SELECT a.user_id, a.email, a.role, a.token_version, a.must_change_password, c.*
       FROM platform.accounts a JOIN platform.companies c ON c.id = a.company_id
      WHERE a.user_id = $1`,
    [payload.sub]
  );
  const row = r.rows[0];
  if (!row || row.token_version !== payload.tv || row.id !== payload.cid) {
    throw new HttpError(401, 'Your session is no longer valid. Please sign in again.', 'UNAUTHENTICATED');
  }
  if (payload.scope === 'session' && row.must_change_password) {
    throw new HttpError(403, 'You must change your temporary password before using the workspace.', 'PASSWORD_CHANGE_REQUIRED');
  }

  const account = { userId: row.user_id, email: row.email, role: row.role, tokenVersion: row.token_version };
  const company = row;
  if (roles && !roles.includes(account.role)) {
    throw new HttpError(403, `This action requires one of these roles: ${roles.join(', ')}.`, 'FORBIDDEN');
  }
  if (requireAccess && payload.scope === 'session' && !accessState(company).hasAccess) {
    throw new HttpError(402, `The subscription for ${company.name} has ended. An admin needs to renew it.`, 'PAYMENT_REQUIRED');
  }
  return { account, company, scope: payload.scope };
}

function issueSession(userId, companyId, tokenVersion) {
  return signToken({ sub: userId, cid: companyId, tv: tokenVersion, scope: 'session' }, SESSION_TTL);
}

function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cleanText(value, max = 120) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').trim().slice(0, max);
}

module.exports = {
  HttpError,
  endpoint,
  authenticate,
  issueSession,
  appUrl,
  EMAIL_RE,
  cleanText,
};
