#!/usr/bin/env node
/**
 * Creates (or resets) the hackathon judge account with the unlimited JUDGE tier.
 *
 *   npm run seed:judge
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local,
 * and the migration in supabase/migrations/0001_profiles.sql applied. Safe to run more than once.
 * Override the defaults with JUDGE_EMAIL / JUDGE_PASSWORD.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.JUDGE_EMAIL ?? "judge@trueprice.app";
const password = process.env.JUDGE_PASSWORD ?? "hackathon2026";

if (!url || !secretKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local.");
  process.exit(1);
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserByEmail(target) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (found || data.users.length < 1000) return found ?? null;
  }
}

// 1. Auth user (email pre-confirmed so it can sign in immediately).
let userId;
const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  const existing = await findUserByEmail(email);
  if (!existing) {
    console.error(`Could not create ${email}: ${created.error.message}`);
    process.exit(1);
  }
  const updated = await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
  if (updated.error) {
    console.error(`Could not update ${email}: ${updated.error.message}`);
    process.exit(1);
  }
  userId = existing.id;
  console.log(`• ${email} already existed — password reset`);
} else {
  userId = created.data.user.id;
  console.log(`• Created ${email}`);
}

// 2. Profile with the JUDGE tier (unlimited scans).
const { error: profileError } = await supabase
  .from("profiles")
  .upsert({ id: userId, email, tier: "JUDGE", updated_at: new Date().toISOString() }, { onConflict: "id" });
if (profileError) {
  console.error(`Could not set the JUDGE tier: ${profileError.message}`);
  console.error("Did you run supabase/migrations/0001_profiles.sql in the Supabase SQL editor?");
  process.exit(1);
}

console.log(`• Tier set to JUDGE (unlimited scans)\n\nJudge login: ${email} / ${password}`);
