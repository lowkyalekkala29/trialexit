/**
 * Browser preview shim.
 *
 * The dashboard is written against chrome.* APIs, so it cannot be opened as a
 * plain file. This shim provides just enough of the extension surface to run it
 * in a normal tab: in-memory storage persisted to localStorage, no-op messaging.
 *
 * It exists so the UI can be reviewed without installing anything. It is NOT
 * part of the shipped extension.
 */

const STORE_KEY = 'trialexit:demo-store';
const SEED_FLAG = 'trialexit:demo-seeded';

/** @type {Record<string, unknown>} */
let store = {};
try {
  store = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
} catch {
  store = {};
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
}

/** Mimic chrome.storage.local.get's three call shapes. */
function pick(keys) {
  if (keys == null) return { ...store };
  if (typeof keys === 'string') return { [keys]: store[keys] };
  if (Array.isArray(keys)) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of keys) out[k] = store[k];
    return out;
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, fallback] of Object.entries(keys)) out[k] = store[k] ?? fallback;
  return out;
}

function daysFromNow(days, hour = 0) {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Three trials in three urgency bands plus one saved, so every state is visible. */
function seed() {
  if (localStorage.getItem(SEED_FLAG)) return;
  localStorage.setItem(SEED_FLAG, '1');
  store.trials = [
    {
      id: 'demo-1',
      serviceId: 'adobe-cc',
      region: 'IN',
      serviceName: 'Adobe Creative Cloud',
      renewsAt: daysFromNow(1.2),
      timezone: 'Asia/Kolkata',
      amount: 167500,
      currency: 'INR',
      trialLengthDays: 7,
      status: 'active',
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      cancelUrlUsed: null,
      cardLabel: 'HDFC card',
    },
    {
      id: 'demo-2',
      serviceId: 'netflix',
      region: 'IN',
      serviceName: 'Netflix',
      renewsAt: daysFromNow(4, 0),
      timezone: 'Asia/Kolkata',
      amount: 49900,
      currency: 'INR',
      trialLengthDays: 7,
      status: 'active',
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      cancelUrlUsed: null,
    },
    {
      id: 'demo-3',
      serviceId: 'chatgpt-plus',
      region: 'US',
      serviceName: 'ChatGPT Plus',
      renewsAt: daysFromNow(18),
      timezone: 'America/New_York',
      amount: 2000,
      currency: 'USD',
      trialLengthDays: 30,
      status: 'active',
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      cancelUrlUsed: null,
    },
    {
      id: 'demo-4',
      serviceId: 'spotify',
      region: 'IN',
      serviceName: 'Spotify Premium',
      renewsAt: daysFromNow(6),
      timezone: 'Asia/Kolkata',
      amount: 11900,
      currency: 'INR',
      trialLengthDays: 7,
      status: 'confirmed_cancelled',
      createdAt: new Date().toISOString(),
      cancelledAt: new Date().toISOString(),
      cancelUrlUsed: 'https://www.spotify.com/in/account/subscription/',
    },
  ];
  persist();
}

seed();

const chromeShim = {
  storage: {
    local: {
      get: async (keys) => pick(keys),
      set: async (obj) => {
        Object.assign(store, obj);
        persist();
      },
      remove: async (key) => {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) delete store[k];
        persist();
      },
    },
    onChanged: { addListener() {} },
  },
  runtime: {
    lastError: null,
    sendMessage: async () => ({ ok: true }),
    openOptionsPage: () => window.open('preview.html', '_self'),
    getURL: (p) => p,
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setTitle: async () => {},
  },
  notifications: { create: async () => {}, clear: async () => {} },
  tabs: { create: async () => {}, query: async () => [] },
  permissions: { request: async () => true },
  alarms: { create: async () => {}, getAll: async () => [], clear: async () => {} },
  scripting: { executeScript: async () => [], registerContentScripts: async () => {} },
};

globalThis.chrome = chromeShim;
