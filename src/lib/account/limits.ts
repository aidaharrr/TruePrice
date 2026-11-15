/** Plan tiers, mirroring the `public.user_tier` enum in supabase/migrations/0001_profiles.sql. */
export type Tier = "GUEST" | "PRO" | "JUDGE";

/** Free scans for GUEST accounts (anonymous or signed up). PRO and JUDGE are unlimited. */
export const FREE_SCAN_LIMIT = 3;

export type AccountStatus = {
  tier: Tier;
  scanCount: number;
  /** null = unlimited. */
  scansRemaining: number | null;
};

export function accountStatus(tier: Tier, scanCount: number): AccountStatus {
  return {
    tier,
    scanCount,
    scansRemaining: tier === "GUEST" ? Math.max(0, FREE_SCAN_LIMIT - scanCount) : null,
  };
}
