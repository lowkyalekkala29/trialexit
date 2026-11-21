/**
 * Public configuration. Every value here is a public identifier, not a secret
 * (the Supabase anon key is designed to ship in clients; row-level security
 * is what protects the data).
 *
 * Empty SUPABASE_URL ⇒ PREVIEW MODE: sign-in is simulated and data stays on
 * this device. A banner says so on every screen.
 */
export const SUPABASE_URL = 'https://tbascuhwmmuvkyscwunq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable__iCQhZcXp0QPyzmVClDomQ_4AHrqDRt';

/** Where the web app lives (used for OAuth redirects and email links). */
export const APP_URL = 'https://trialexit.vercel.app';

/** Microsoft Entra app (Outlook scan in the extension). */
export const OUTLOOK_CLIENT_ID = '';

export const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
