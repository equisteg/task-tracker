'use strict';

const crypto = require('crypto');

function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw Object.assign(new Error('JWT_SECRET must be set to a random string of at least 32 characters.'), { status: 500, code: 'SERVER_NOT_CONFIGURED' });
  }
  return secret;
}

// ---------- Password hashing (scrypt) ----------
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    const [algo, saltB64, keyB64] = String(stored || '').split('$');
    if (algo !== 'scrypt' || !saltB64 || !keyB64) return resolve(false);
    const expected = Buffer.from(keyB64, 'base64');
    crypto.scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) return resolve(false);
      resolve(crypto.timingSafeEqual(key, expected));
    });
  });
}

function validatePasswordStrength(password) {
  const pw = String(password || '');
  if (pw.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain both letters and numbers.';
  return null;
}

// ---------- Signed tokens (HMAC-SHA256, JWT-like) ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signToken(payload, ttlSeconds) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', requireSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token, expectedScope) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', requireSecret()).update(encoded).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (expectedScope) {
    const scopes = Array.isArray(expectedScope) ? expectedScope : [expectedScope];
    if (!scopes.includes(payload.scope)) return null;
  }
  return payload;
}

// ---------- Symmetric encryption for stored secrets (SMTP passwords) ----------
function encryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY || `${requireSecret()}::smtp-at-rest`;
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(payload) {
  const [v, ivB64, tagB64, dataB64] = String(payload || '').split(':');
  if (v !== 'v1') throw new Error('Unsupported secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

// ---------- OTP & random credentials ----------
function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashOtp(registrationId, code) {
  return crypto.createHmac('sha256', requireSecret()).update(`otp:${registrationId}:${code}`).digest('hex');
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

// Readable temporary password: avoids ambiguous characters, always has letters + digits.
function generateTempPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set, n) => Array.from({ length: n }, () => set[crypto.randomInt(0, set.length)]).join('');
  return `${pick(letters, 4)}-${pick(digits, 4)}-${pick(letters, 4)}`;
}

function randomId(prefix) {
  return `${prefix}${crypto.randomBytes(9).toString('base64url')}`;
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  signToken,
  verifyToken,
  encryptSecret,
  decryptSecret,
  generateOtp,
  hashOtp,
  safeEqualHex,
  generateTempPassword,
  randomId,
};
