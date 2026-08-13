import type { createClient } from "@/lib/supabase/client";

type SB = NonNullable<ReturnType<typeof createClient>>;

const UTM_STORAGE_KEY = "runion.utm";

export type CapturedUtm = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  ts: string;
};

// First-touch capture: read utm_source/medium/campaign off the current URL and
// stash them in localStorage the FIRST time we see any of them. We never
// overwrite an earlier capture, so the poster that actually brought someone in
// wins even if they later arrive via another link. No-op server-side, and a
// no-op when no UTM params are present.
export function captureUtm() {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(UTM_STORAGE_KEY)) return; // first-touch only
    const params = new URLSearchParams(window.location.search);
    const source = params.get("utm_source");
    const medium = params.get("utm_medium");
    const campaign = params.get("utm_campaign");
    if (!source && !medium && !campaign) return;
    const captured: CapturedUtm = {
      source,
      medium,
      campaign,
      ts: new Date().toISOString(),
    };
    window.localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(captured));
  } catch {
    // localStorage can throw in private mode — attribution is best-effort.
  }
}

export function storedUtm(): CapturedUtm | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(UTM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CapturedUtm>;
    return {
      source: parsed.source ?? null,
      medium: parsed.medium ?? null,
      campaign: parsed.campaign ?? null,
      ts: parsed.ts ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// Stamp the captured UTM onto the user's row, once. The `.is(..., null)` guard
// makes this first-touch at the DB level too: it only fills the columns when
// they're still empty, so re-saving a profile never rewrites the origin.
// Best-effort — silently ignores errors (e.g. columns not migrated yet).
export async function stampSignupUtm(supabase: SB | null, userId: string | undefined) {
  if (!supabase || !userId) return;
  const utm = storedUtm();
  if (!utm || (!utm.source && !utm.medium && !utm.campaign)) return;
  try {
    await supabase
      .from("users")
      .update({
        signup_utm_source: utm.source,
        signup_utm_medium: utm.medium,
        signup_utm_campaign: utm.campaign,
      })
      .eq("id", userId)
      .is("signup_utm_source", null);
  } catch {
    // Attribution is non-critical; never block a profile save on it.
  }
}
