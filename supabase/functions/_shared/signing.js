/**
 * HMAC-signed one-click links in reminder emails ("I cancelled" / "Keeping it").
 * The link carries trial id + action + expiry; the edge function verifies it
 * before touching the database, so links can't be forged or reused forever.
 */
const enc = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** @param {{ trialId: string, action: string, exp: number }} p */
export async function signAction(p, secret) {
  const msg = `${p.trialId}.${p.action}.${p.exp}`;
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(msg));
  return b64url(sig);
}

/** @returns {Promise<boolean>} */
export async function verifyAction(p, sig, secret, now = Date.now()) {
  if (!sig || !p.trialId || !p.action || !(Number(p.exp) > now)) return false;
  try {
    const msg = `${p.trialId}.${p.action}.${p.exp}`;
    return await crypto.subtle.verify('HMAC', await key(secret), unb64url(sig), enc.encode(msg));
  } catch {
    return false;
  }
}
