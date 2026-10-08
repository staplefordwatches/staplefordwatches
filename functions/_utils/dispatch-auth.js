const encoder = new TextEncoder();
const COOKIE = 'sw_dispatch';
export const COOKIE_OPTIONS = 'Path=/api/dispatch; HttpOnly; Secure; SameSite=Strict';

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), char => char.charCodeAt(0));
}

async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function equalSecrets(left, right) {
  const a = await fingerprint(String(left || ''));
  const b = await fingerprint(String(right || ''));
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function issueToken(secret, purpose, data, maxAge, now = Date.now()) {
  const payload = base64url(encoder.encode(JSON.stringify({ purpose, data, exp: now + maxAge })));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload))));
  return `${payload}.${signature}`;
}

export async function readToken(secret, purpose, token, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const valid = await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(payload));
    if (!valid) return null;
    const decoded = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (decoded.purpose !== purpose || !Number.isFinite(decoded.exp) || decoded.exp <= now) return null;
    return decoded.data;
  } catch { return null; }
}

export async function authenticated(request, secret) {
  const cookies = request.headers.get('cookie') || '';
  const value = cookies.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return Boolean(await readToken(secret, 'session', value));
}

export async function sessionCookie(secret) {
  const token = await issueToken(secret, 'session', { nonce: crypto.randomUUID() }, 12 * 60 * 60 * 1000);
  return `${COOKIE}=${token}; ${COOKIE_OPTIONS}; Max-Age=43200`;
}

export const clearSessionCookie = () => `${COOKIE}=; ${COOKIE_OPTIONS}; Max-Age=0`;
