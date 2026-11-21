/**
 * OAuth client IDs. Both are public identifiers, not secrets.
 *
 * Gmail:   set in manifest.json → oauth2.client_id (Chrome's identity API reads it there).
 * Outlook: Azure app registration → Application (client) ID, pasted below.
 *          Redirect URI to register (platform "Single-page application"):
 *          https://<extension-id>.chromiumapp.org/   (shown in the dashboard footer)
 */
export const OUTLOOK_CLIENT_ID = '';
