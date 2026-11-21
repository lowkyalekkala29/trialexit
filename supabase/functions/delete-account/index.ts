// Permanently deletes the calling user (and, via cascades, all their data).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return new Response('unauthorized', { status: 401, headers: cors });
  const del = await db.auth.admin.deleteUser(data.user.id);
  if (del.error) return new Response(del.error.message, { status: 500, headers: cors });
  return Response.json({ ok: true }, { headers: cors });
});
