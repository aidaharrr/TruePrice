import "server-only";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { FREE_SCAN_LIMIT, accountStatus, type AccountStatus, type Tier } from "@/lib/account/limits";

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new AccountError("Supabase service key is not configured");
  return client;
}

/** Reads the user's profile, creating it if the signup trigger hasn't (e.g. users created before the migration). */
export async function getAccountStatus(user: User): Promise<AccountStatus> {
  const db = admin();
  const { data, error } = await db.from("profiles").select("tier, scan_count").eq("id", user.id).maybeSingle();
  if (error) throw new AccountError(`profiles read failed: ${error.message}`);
  if (data) return accountStatus(data.tier as Tier, data.scan_count);

  const { data: created, error: insertError } = await db
    .from("profiles")
    .upsert({ id: user.id, email: user.email ?? null }, { onConflict: "id" })
    .select("tier, scan_count")
    .single();
  if (insertError) throw new AccountError(`profiles insert failed: ${insertError.message}`);
  return accountStatus(created.tier as Tier, created.scan_count);
}

/**
 * Atomically uses one scan (see `public.consume_scan`). Returns the new status,
 * or null if a GUEST is already at the free limit.
 */
export async function consumeScan(userId: string): Promise<AccountStatus | null> {
  const { data, error } = await admin().rpc("consume_scan", { p_user_id: userId, p_free_limit: FREE_SCAN_LIMIT });
  if (error) throw new AccountError(`consume_scan failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? accountStatus(row.tier as Tier, row.scan_count) : null;
}
