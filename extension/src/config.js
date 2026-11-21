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

/**
 * Google OAuth web client (public ID, not a secret). Used for Google's own
 * "Sign in with Google" button on the web app, so the consent screen shows
 * our domain instead of the Supabase project address.
 */
export const GOOGLE_CLIENT_ID = '1098958409027-m9rit0l0do0rg6ia0c8q6fp7bg85p54d.apps.googleusercontent.com';

/** Microsoft Entra app (Outlook scan in the extension). */
export const OUTLOOK_CLIENT_ID = '';

/** Fixed extension ID (manifest "key"), same for sideloaded and store installs. */
export const EXTENSION_ID = 'mkkpnhiokdmpjlkapkhhiifpefgjegbp';

export const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
