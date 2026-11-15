import "server-only";
import type { User } from "@supabase/supabase-js";
import { getRequestUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type GuardFailure = {
  ok: false;
  status: 401 | 500;
  code: "AUTH_REQUIRED" | "SERVER_MISCONFIGURED";
  message: string;
};

/**
 * Every scan route requires a Supabase session — a real account or an anonymous guest session
 * the browser creates automatically. That's what lets the scan counter belong to someone.
 */
export async function requireUser(request: Request): Promise<{ ok: true; user: User } | GuardFailure> {
  if (!isSupabaseConfigured || !getSupabaseAdmin()) {
    console.error("[auth] Supabase env vars are not set");
    return {
      ok: false,
      status: 500,
      code: "SERVER_MISCONFIGURED",
      message: "Accounts are temporarily unavailable. Please try again later.",
    };
  }
  const user = await getRequestUser(request);
  if (!user) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", message: "Please sign in to scan products." };
  }
  return { ok: true, user };
}
