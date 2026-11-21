/**
 * Two-way merge between this device and the account. Pure.
 * Last write wins per trial (updatedAt); deletions travel as tombstones so a
 * trial removed on the phone doesn't come back from the laptop.
 */

const ts = (v) => (v ? new Date(v).getTime() || 0 : 0);
const stamp = (t) => Math.max(ts(t.updatedAt), ts(t.createdAt));

/**
 * @param {{ trials: any[], tombstones: {id:string, deletedAt:string}[] }} local
 * @param {{ trials: any[], tombstones: {id:string, deletedAt:string}[] }} remote
 * @returns {{ trials: any[], tombstones: any[], push: any[], pushDeletes: any[] }}
 */
export function mergeTrials(local, remote) {
  const dead = new Map();
  for (const d of [...(local.tombstones ?? []), ...(remote.tombstones ?? [])]) {
    if (!dead.has(d.id) || ts(d.deletedAt) > ts(dead.get(d.id).deletedAt)) dead.set(d.id, d);
  }
  const remoteById = new Map((remote.trials ?? []).map((t) => [t.id, t]));
  const localById = new Map((local.trials ?? []).map((t) => [t.id, t]));
  const ids = new Set([...remoteById.keys(), ...localById.keys()]);
  const trials = [];
  const push = [];
  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    const winner = !l ? r : !r ? l : stamp(l) >= stamp(r) ? l : r;
    const d = dead.get(id);
    if (d && ts(d.deletedAt) >= stamp(winner)) continue; // deleted after its last edit
    trials.push(winner);
    if (winner === l && (!r || stamp(l) > stamp(r))) push.push(l);
  }
  const remoteDead = new Set((remote.tombstones ?? []).map((d) => d.id));
  const pushDeletes = [...dead.values()].filter((d) => !remoteDead.has(d.id));
  return { trials, tombstones: [...dead.values()], push, pushDeletes };
}

/** camelCase app trial ↔ snake_case database row */
export function toRow(t, userId) {
  return {
    id: t.id,
    user_id: userId,
    service_id: t.serviceId,
    region: t.region,
    service_name: t.serviceName,
    renews_at: t.renewsAt,
    timezone: t.timezone,
    amount: t.amount ?? 0,
    currency: t.currency,
    trial_length_days: t.trialLengthDays ?? 7,
    status: t.status,
    created_at: t.createdAt,
    cancelled_at: t.cancelledAt ?? null,
    cancel_url_used: t.cancelUrlUsed ?? null,
    card_label: t.cardLabel ?? null,
    source: t.source ?? null,
    updated_at: t.updatedAt ?? t.createdAt,
    deleted_at: null,
  };
}

export function fromRow(r) {
  return {
    id: r.id,
    serviceId: r.service_id,
    region: r.region,
    serviceName: r.service_name,
    renewsAt: r.renews_at,
    timezone: r.timezone,
    amount: r.amount ?? 0,
    currency: r.currency,
    trialLengthDays: r.trial_length_days,
    status: r.status,
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    cancelUrlUsed: r.cancel_url_used,
    cardLabel: r.card_label ?? undefined,
    source: r.source ?? undefined,
    updatedAt: r.updated_at,
  };
}
