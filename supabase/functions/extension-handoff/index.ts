// Signs the TrialExit Chrome extension in as the user who is signed in on the
// website, with its OWN session (sharing one refresh token between two apps
// would trip Supabase's refresh-token reuse detection and log both out).
//
// The caller must present a valid user JWT; the one-time token returned is for
// that same user only, sends no email, and expires quickly. The website passes
// it to the extension via chrome.runtime.sendMessage, which Chrome only allows
// from origins listed in the extension's externally_connectable.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': 'https://trialexit.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user?.email) return new Response('unauthorized', { status: 401, headers: cors });
  const link = await db.auth.admin.generateLink({ type: 'magiclink', email: data.user.email });
  if (link.error) return Response.json({ ok: false, error: link.error.message }, { status: 500, headers: cors });
  return Response.json({ ok: true, email: data.user.email, token_hash: link.data.properties.hashed_token }, { headers: cors });
});
