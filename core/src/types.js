/**
 * Shared type definitions. JSDoc only — no runtime code, no build step.
 */

/**
 * @typedef {'IN' | 'US'} Region
 */

/**
 * One cancellation path for one service in one region.
 * Region-keyed rows: the same service appears once per region because the
 * cancel URL differs (e.g. Spotify vs Spotify India).
 *
 * @typedef {Object} DirectoryEntry
 * @property {string}  serviceId     Stable slug, shared across regions. e.g. "netflix"
 * @property {Region}  region
 * @property {string}  name          Display name, e.g. "Netflix"
 * @property {string}  cancelUrl     Deep link to the cancellation surface
 * @property {string[]} domains      Hostnames where a trial is likely sold
 * @property {string[]} steps        Ordered human instructions
 * @property {boolean} requiresChat  True when the only path is support chat/phone
 * @property {number|null} refundWindowDays  Refund window after charge, if any
 * @property {string|null} lastVerifiedAt    ISO date of last successful check
 * @property {boolean} verified      False => UI must show a "may be outdated" badge
 * @property {string} [note]         Caveat shown in the UI
 */

/**
 * Lifecycle of a single trial. Cancellation is NEVER inferred.
 * @typedef {'active' | 'awaiting_confirmation' | 'confirmed_cancelled' | 'charged' | 'kept' | 'dismissed'} TrialStatus
 */

/**
 * @typedef {Object} Trial
 * @property {string} id
 * @property {string} serviceId
 * @property {Region} region
 * @property {string} serviceName
 * @property {string} renewsAt         ISO-8601 instant WITH offset, e.g. 2026-11-27T00:00:00+05:30
 * @property {string} timezone         IANA zone the renewal wall-clock was expressed in
 * @property {number} amount           Renewal amount in minor units (paise / cents)
 * @property {'INR'|'USD'} currency
 * @property {number} trialLengthDays  Used to pick the alert lead time
 * @property {TrialStatus} status
 * @property {string} createdAt        ISO instant
 * @property {string|null} cancelledAt ISO instant when the user confirmed cancellation
 * @property {string|null} cancelUrlUsed
 * @property {string} [source]         how it was captured: manual | page | email
 * @property {string} [cardLabel]      e.g. "HDFC card" / "UPI AutoPay" — user's own label
 */

/**
 * @typedef {Object} Alert
 * @property {string} at      ISO instant to fire
 * @property {'primary'|'reminder'|'final'|'urgent'|'lastcall'} kind
 * @property {string} label   Human description for the calendar/notification
 */

export {};
