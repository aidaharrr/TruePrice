import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/env";

/** Supabase client bound to the request's auth cookies (route handlers / server components). */
export async function getSupabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a context that can't set cookies; the proxy (src/proxy.ts) refreshes the session instead.
        }
      },
    },
  });
}

/**
 * The verified user making this request, or null.
 * Browser requests carry the session in cookies; scripts may send `Authorization: Bearer <access token>`.
 * `auth.getUser()` validates the token with Supabase, so a forged cookie or JWT is rejected.
 */
export async function getRequestUser(request: Request): Promise<User | null> {
  if (!isSupabaseConfigured) return null;

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(bearer);
    return error ? null : data.user;
  }

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}
