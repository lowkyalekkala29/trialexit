/**
 * Licence validation. Dormant until FREE_LAUNCH flips, but the seam exists so
 * turning on payments is a config change, not a refactor.
 *
 * The vendor is a merchant of record (Gumroad / Lemon Squeezy style): they host
 * checkout, handle tax and both currencies, take a commission, and hand back a
 * license key. No backend of our own, which is the whole point.
 */

export const LICENCE_VENDOR = 'gumroad';

/** Fill these from the seller dashboard when payments go live. */
export const CONFIG = {
  productId: '',
  verifyUrl: 'https://api.gumroad.com/v2/licenses/verify',
};

const CACHE_KEY = 'licenceCache';
const RECHECK_MS = 7 * 24 * 3600 * 1000;

/**
 * @param {string} key
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function validateLicence(key) {
  const trimmed = String(key ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (!CONFIG.productId) return { ok: false, reason: 'not-configured' };

  try {
    const body = new URLSearchParams({
      product_id: CONFIG.productId,
      license_key: trimmed,
      increment_uses_count: 'false',
    });
    const res = await fetch(CONFIG.verifyUrl, { method: 'POST', body });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const data = await res.json();
    if (!data?.success) return { ok: false, reason: 'invalid' };
    const purchase = data.purchase ?? {};
    if (purchase.refunded || purchase.chargebacked || purchase.subscription_cancelled_at) {
      return { ok: false, reason: 'revoked' };
    }
    await chrome.storage.local.set({ [CACHE_KEY]: { key: trimmed, at: Date.now() } });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/**
 * Offline-tolerant check: a previously validated key stays valid for a week,
 * so a paying user is never locked out because a third party is down.
 * @returns {Promise<boolean>}
 */
export async function isUnlocked() {
  const got = await chrome.storage.local.get([CACHE_KEY, 'settings']);
  if (got?.settings?.unlocked) return true;
  const cached = got?.[CACHE_KEY];
  if (!cached?.key) return false;
  if (Date.now() - cached.at < RECHECK_MS) return true;
  const res = await validateLicence(cached.key);
  return res.ok;
}
