import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client: bypasses RLS. Server-only — used to read/update scan counts,
 * which the browser is never allowed to write. null if the secret key isn't configured.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !secretKey) return null;
  admin ??= createClient(SUPABASE_URL, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
