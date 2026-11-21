/**
 * Web platform adapter.
 *
 * The dashboard is written against chrome.* so the extension and the web app
 * share one codebase. Here those calls are backed by localStorage. Unlike
 * demo/shim.js this seeds nothing: it is the real, shipped web app.
 *
 * Classic script on purpose: it must define `chrome` before the dashboard
 * module evaluates.
 */
(() => {
  // Keep the browser's real `chrome` (present when the TrialExit extension is
  // installed and lists this site in externally_connectable) for talking to it.
  globalThis.__extChrome = globalThis.chrome?.runtime?.sendMessage ? globalThis.chrome : null;
  const STORE_KEY = 'trialexit:store';
  /** @type {Record<string, unknown>} */
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    store = {};
  }
  const listeners = [];

  function persist(changes) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* private mode or quota: the session still works, it just won't persist */
    }
    for (const fn of listeners) {
      try {
        fn(changes, 'local');
      } catch {
        /* a listener failing must not break saving */
      }
    }
  }

  function pick(keys) {
    if (keys == null) return { ...store };
    if (typeof keys === 'string') return { [keys]: store[keys] };
    const out = {};
    if (Array.isArray(keys)) for (const k of keys) out[k] = store[k];
    else for (const [k, d] of Object.entries(keys)) out[k] = store[k] ?? d;
    return out;
  }

  // Another tab (e.g. the one opened by the email sign-in link) changed the
  // data: reload it and tell listeners, like chrome.storage does.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return;
    let next = {};
    try {
      next = JSON.parse(e.newValue ?? '{}') ?? {};
    } catch {
      return;
    }
    const changes = {};
    for (const k of new Set([...Object.keys(store), ...Object.keys(next)])) {
      if (JSON.stringify(store[k]) !== JSON.stringify(next[k])) changes[k] = { oldValue: store[k], newValue: next[k] };
    }
    store = next;
    for (const fn of listeners) fn(changes, 'local');
  });

  const noop = async () => {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => pick(keys),
        set: async (obj) => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) changes[k] = { oldValue: store[k], newValue: v };
          Object.assign(store, obj);
          persist(changes);
        },
        clear: async () => {
          const changes = {};
          for (const k of Object.keys(store)) changes[k] = { oldValue: store[k] };
          store = {};
          persist(changes);
        },
        remove: async (key) => {
          const changes = {};
          for (const k of Array.isArray(key) ? key : [key]) {
            changes[k] = { oldValue: store[k] };
            delete store[k];
          }
          persist(changes);
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: {
      lastError: null,
      sendMessage: async () => ({ ok: true }),
      openOptionsPage: noop,
      getURL: (p) => p,
    },
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop },
    notifications: { create: noop, clear: noop },
    tabs: { create: async ({ url }) => window.open(url, '_blank', 'noopener') },
    permissions: { request: async () => false },
    alarms: { create: noop, getAll: async () => [], clear: noop },
  };
})();
