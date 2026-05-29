import type { CitySlug } from "@/lib/types";
import type { createClient } from "@/lib/supabase/client";

export type RunIntent = "tempo" | "social";

export type RunRow = {
  id: string;
  city: CitySlug;
  title: string;
  description: string | null;
  locationName: string;
  lat: number;
  lng: number;
  startTime: string;
  paceSeconds: number;
  paceMin: string;
  paceMax: string;
  distanceKm: number;
  intent: RunIntent;
  organiserId: string | null;
  organiserName?: string | null;
  organiserWhatsapp?: string | null;
  organiserSocials?: string | null;
  organiserRunnerType?: string | null;
  organiserRunIntents?: string[] | null;
  organiserCompletedRuns?: number | null;
  maxGroupSize: number;
  currentSpots: number;
  status: string;
  recurrence?: "weekly" | null;
  womenOnly?: boolean;
  // Straight-line distance from the user's location to the run's start point,
  // in km. Null when we don't have the user's location. Used to sort and to
  // show the "X.X km away" chip — never to hard-filter runs out.
  proximityKm?: number | null;
};

export type CreateRunInput = {
  city: CitySlug;
  title?: string | null;
  description?: string | null;
  locationName: string;
  lat: number;
  lng: number;
  startTime: string;
  paceSeconds: number;
  distanceKm: number;
  intent: RunIntent;
  maxGroupSize?: number;
  recurrence?: "weekly" | null;
  womenOnly?: boolean;
};

type SB = NonNullable<ReturnType<typeof createClient>>;

const FETCH_COLUMNS =
  "id, city, title, description, location_name, location_lat, location_lng, start_time, run_date, time, pace_seconds, pace_min, pace_max, distance_km, intent, goal, organiser_id, max_group_size, current_spots, spots_total, spots_taken, status, recurrence, women_only";

async function sweepStaleRuns(supabase: SB) {
  await supabase.rpc("expire_stale_runs").then(() => undefined, () => undefined);
}

// Haversine distance between two lat/lng points, in km.
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function fetchOpenRuns(
  supabase: SB | null,
  opts: { city: CitySlug; lat?: number; lng?: number; radiusM?: number }
): Promise<RunRow[]> {
  if (!supabase) return [];
  await sweepStaleRuns(supabase);
  const { city, lat, lng } = opts;

  // Always fetch every open run in the city. Distance is used as a *sort*, not
  // a hard radius cut — so "Near me" surfaces the closest runs even when none
  // sit within 2 km. Proximity is computed client-side via haversine below.
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("runs")
    .select(FETCH_COLUMNS)
    .eq("city", city)
    .in("status", ["active", "full"])
    .gte("run_date", today)
    .order("start_time", { ascending: true, nullsFirst: false })
    .order("run_date", { ascending: true });

  if (error || !data) return [];
  let rows = data
    .map((row) => toRunRow(row as Record<string, unknown>, city))
    .filter((row): row is RunRow => Boolean(row));

  if (typeof lat === "number" && typeof lng === "number") {
    rows = rows
      .map((run) => ({ ...run, proximityKm: haversineKm(lat, lng, run.lat, run.lng) }))
      .sort((a, b) => (a.proximityKm ?? Infinity) - (b.proximityKm ?? Infinity));
  }

  return enrichRunsWithHost(supabase, rows);
}

// Attaches a lightweight host mini-profile to each run so the card can show
// who's hosting before a request: name, runner type, intents, socials, and
// completed-run count. WhatsApp is deliberately excluded — it stays private
// until the host approves the request.
async function enrichRunsWithHost(supabase: SB, rows: RunRow[]): Promise<RunRow[]> {
  const hostIds = Array.from(
    new Set(rows.map((r) => r.organiserId).filter((id): id is string => Boolean(id)))
  );
  if (!hostIds.length) return rows;

  // host_public_profiles is SECURITY DEFINER so attendees (who can't read
  // another user's row under RLS) still get the host's public mini-profile.
  const [usersResult, stats] = await Promise.all([
    supabase.rpc("host_public_profiles", { ids: hostIds }),
    fetchUserStatsBatch(supabase, hostIds),
  ]);

  const hostMap = new Map<
    string,
    { name?: string | null; runner_type?: string | null; run_intents?: string[] | null; socials_url?: string | null }
  >();
  if (!usersResult.error && Array.isArray(usersResult.data)) {
    for (const row of usersResult.data as Array<{
      id: string;
      name?: string | null;
      runner_type?: string | null;
      run_intents?: string[] | null;
      socials_url?: string | null;
    }>) {
      hostMap.set(row.id, row);
    }
  }

  return rows.map((run) => {
    if (!run.organiserId) return run;
    const host = hostMap.get(run.organiserId);
    return {
      ...run,
      organiserName: host?.name ?? run.organiserName ?? null,
      organiserRunnerType: host?.runner_type ?? null,
      organiserRunIntents: host?.run_intents ?? null,
      organiserSocials: host?.socials_url ?? null,
      organiserCompletedRuns: stats[run.organiserId]?.completedRuns ?? 0,
    };
  });
}

export async function createRun(
  supabase: SB | null,
  input: CreateRunInput,
  profileId: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase client unavailable." };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return { ok: false, error: "Pick a valid start location." };
  }
  if (!input.locationName.trim()) {
    return { ok: false, error: "Location name is required." };
  }

  const start = new Date(input.startTime);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, error: "Pick a valid start time." };
  }

  const day = start.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const runDate = input.startTime.slice(0, 10);
  const time = input.startTime.slice(11, 16);
  const paceMinSec = Math.max(180, input.paceSeconds - 10);
  const paceMaxSec = Math.min(480, input.paceSeconds + 10);
  const groupSize = input.maxGroupSize ?? 3;

  const payload = {
    title: input.title ?? null,
    description: input.description ?? null,
    pace_min: secondsToInterval(paceMinSec),
    pace_max: secondsToInterval(paceMaxSec),
    pace_seconds: input.paceSeconds,
    distance_km: input.distanceKm,
    start_time: input.startTime,
    location_name: input.locationName.trim(),
    intent: input.intent,
    created_by: profileId,
    organiser_id: profileId,
    max_group_size: groupSize,
    current_spots: 1,
    city: input.city,
    location: `POINT(${input.lng} ${input.lat})`,
    day,
    run_date: runDate,
    time,
    goal: input.intent,
    spots_total: groupSize,
    spots_taken: 1,
    status: "active",
    recurrence: input.recurrence ?? null,
    women_only: input.womenOnly ?? false,
  };

  const { data, error } = await supabase.from("runs").insert(payload).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id as string | undefined };
}

export type ParticipantStatus = "requested" | "confirmed" | "declined";

export type HostOutcome = "showed_up" | "no_show" | "skipped";

export type ParticipantRow = {
  id: string;
  runId: string;
  userId: string;
  status: ParticipantStatus;
  requesterName: string | null;
  requesterWhatsapp: string | null;
  requesterSocials: string | null;
  hostOutcome: HostOutcome | null;
  hostRunAgain: boolean | null;
  hostReviewedAt: string | null;
  joinerRunAgain: boolean | null;
  joinerReviewedAt: string | null;
  createdAt: string;
};

export type UserStats = {
  completedRuns: number;
  mutualAffinity: number;
};

export type HostedBucket = {
  run: RunRow;
  pending: ParticipantRow[];
  confirmed: ParticipantRow[];
};

export type MyActivity = {
  pending: { participant: ParticipantRow; run: RunRow }[];
  confirmed: { participant: ParticipantRow; run: RunRow }[];
  pastConfirmed: { participant: ParticipantRow; run: RunRow }[];
  hosted: HostedBucket[];
  pastHosted: HostedBucket[];
};

export async function fetchMyActivity(
  supabase: SB | null,
  args: { profileId: string }
): Promise<MyActivity> {
  if (!supabase) return { pending: [], confirmed: [], pastConfirmed: [], hosted: [], pastHosted: [] };
  await sweepStaleRuns(supabase);
  const { profileId } = args;

  const [participantResult, hostedResult] = await Promise.all([
    supabase
      .from("run_participants")
      .select(`id, run_id, user_id, status, requester_name, requester_whatsapp, requester_socials, host_outcome, host_run_again, host_reviewed_at, joiner_run_again, joiner_reviewed_at, created_at, run:runs!inner(${FETCH_COLUMNS})`)
      .eq("user_id", profileId)
      .in("status", ["requested", "confirmed"]),
    supabase
      .from("runs")
      .select(FETCH_COLUMNS)
      .eq("organiser_id", profileId)
      .in("status", ["active", "full", "completed", "expired"])
      .order("start_time", { ascending: false, nullsFirst: false }),
  ]);

  const pending: { participant: ParticipantRow; run: RunRow }[] = [];
  const confirmed: { participant: ParticipantRow; run: RunRow }[] = [];
  const pastConfirmed: { participant: ParticipantRow; run: RunRow }[] = [];

  if (!participantResult.error && participantResult.data) {
    for (const row of participantResult.data as Record<string, unknown>[]) {
      const runRaw = row.run as Record<string, unknown> | null;
      if (!runRaw) continue;
      const run = toRunRow(runRaw, (runRaw.city as CitySlug) ?? "bcn");
      if (!run) continue;
      const participant = toParticipantRow(row);
      if (!participant) continue;
      if (participant.status === "requested") {
        pending.push({ participant, run });
      } else if (participant.status === "confirmed") {
        if (run.status === "completed" || run.status === "expired") {
          pastConfirmed.push({ participant, run });
        } else {
          confirmed.push({ participant, run });
        }
      }
    }
  }

  // Batch-load host name/whatsapp for participant runs so the joiner can
  // message the host with a prefilled run-details message. We only enrich
  // confirmed and pastConfirmed entries — pending requests intentionally
  // don't expose the host's contact.
  const hostIds = Array.from(
    new Set(
      [...confirmed, ...pastConfirmed]
        .map(({ run }) => run.organiserId)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (hostIds.length) {
    const { data: hostRows, error: hostError } = await supabase
      .from("users")
      .select("id, name, whatsapp")
      .in("id", hostIds);
    if (!hostError && hostRows) {
      const hostMap = new Map<string, { name?: string | null; whatsapp?: string | null }>();
      for (const row of hostRows as Array<{ id: string; name?: string | null; whatsapp?: string | null }>) {
        hostMap.set(row.id, { name: row.name, whatsapp: row.whatsapp });
      }
      for (const entry of [...confirmed, ...pastConfirmed]) {
        const host = entry.run.organiserId ? hostMap.get(entry.run.organiserId) : null;
        if (host) {
          entry.run.organiserName = host.name ?? null;
          entry.run.organiserWhatsapp = host.whatsapp ?? null;
        }
      }
    }
  }

  const hostedRuns: RunRow[] =
    !hostedResult.error && hostedResult.data
      ? (hostedResult.data as Record<string, unknown>[])
          .map((row) => toRunRow(row, (row.city as CitySlug) ?? "bcn"))
          .filter((r): r is RunRow => Boolean(r))
      : [];

  let hostedRequests: ParticipantRow[] = [];
  if (hostedRuns.length) {
    const ids = hostedRuns.map((r) => r.id);
    const { data, error } = await supabase
      .from("run_participants")
      .select("id, run_id, user_id, status, requester_name, requester_whatsapp, requester_socials, host_outcome, host_run_again, host_reviewed_at, joiner_run_again, joiner_reviewed_at, created_at")
      .in("run_id", ids);
    if (!error && data) {
      hostedRequests = (data as Record<string, unknown>[])
        .map(toParticipantRow)
        .filter((p): p is ParticipantRow => Boolean(p));
    }
  }

  const hostedAll = hostedRuns.map((run) => {
    const requests = hostedRequests.filter((r) => r.runId === run.id);
    return {
      run,
      pending: requests.filter((r) => r.status === "requested"),
      confirmed: requests.filter((r) => r.status === "confirmed"),
    };
  });

  const isPast = (s: string) => s === "completed" || s === "expired";
  const hosted = hostedAll.filter((h) => !isPast(h.run.status));
  const pastHosted = hostedAll.filter((h) => isPast(h.run.status));

  return { pending, confirmed, pastConfirmed, hosted, pastHosted };
}

export async function setJoinerReview(
  supabase: SB | null,
  args: { participantId: string; runAgain: boolean }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase client unavailable." };
  const { error } = await supabase
    .from("run_participants")
    .update({
      joiner_run_again: args.runAgain,
      joiner_reviewed_at: new Date().toISOString(),
    })
    .eq("id", args.participantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchUserStatsBatch(
  supabase: SB | null,
  ids: string[]
): Promise<Record<string, UserStats>> {
  if (!supabase || ids.length === 0) return {};
  const unique = Array.from(new Set(ids));
  const { data, error } = await supabase.rpc("user_stats_batch", { ids: unique });
  if (error || !Array.isArray(data)) return {};
  const out: Record<string, UserStats> = {};
  for (const row of data as Array<{ user_id: string; completed_runs: number; mutual_affinity: number }>) {
    out[row.user_id] = {
      completedRuns: row.completed_runs ?? 0,
      mutualAffinity: row.mutual_affinity ?? 0,
    };
  }
  return out;
}

export async function wrapUpRun(
  supabase: SB | null,
  args: {
    runId: string;
    outcomes: { participantId: string; outcome: HostOutcome; runAgain: boolean }[];
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase client unavailable." };
  const reviewedAt = new Date().toISOString();
  for (const o of args.outcomes) {
    const { error } = await supabase
      .from("run_participants")
      .update({
        host_outcome: o.outcome,
        host_run_again: o.runAgain,
        host_reviewed_at: reviewedAt,
      })
      .eq("id", o.participantId);
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await supabase
    .from("runs")
    .update({ status: "completed", completed_at: reviewedAt })
    .eq("id", args.runId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function cancelRun(
  supabase: SB | null,
  args: { runId: string; reason: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase client unavailable." };
  const { error } = await supabase
    .from("runs")
    .update({
      status: "expired",
      cancelled_at: new Date().toISOString(),
      cancel_reason: args.reason,
    })
    .eq("id", args.runId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setRequestStatus(
  supabase: SB | null,
  args: { participantId: string; status: ParticipantStatus }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase client unavailable." };
  const { error } = await supabase
    .from("run_participants")
    .update({ status: args.status })
    .eq("id", args.participantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function cancelOwnRequest(
  supabase: SB | null,
  args: { participantId: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase client unavailable." };
  const { error } = await supabase
    .from("run_participants")
    .delete()
    .eq("id", args.participantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function toParticipantRow(row: Record<string, unknown>): ParticipantRow | null {
  const id = row.id != null ? String(row.id) : null;
  const runId = row.run_id != null ? String(row.run_id) : null;
  const userId = row.user_id != null ? String(row.user_id) : null;
  const status = stringFromValue(row.status);
  if (!id || !runId || !userId || !status) return null;
  if (status !== "requested" && status !== "confirmed" && status !== "declined") return null;
  return {
    id,
    runId,
    userId,
    status,
    requesterName: stringFromValue(row.requester_name) ?? null,
    requesterWhatsapp: stringFromValue(row.requester_whatsapp) ?? null,
    requesterSocials: stringFromValue(row.requester_socials) ?? null,
    hostOutcome: (() => {
      const v = stringFromValue(row.host_outcome);
      return v === "showed_up" || v === "no_show" || v === "skipped" ? v : null;
    })(),
    hostRunAgain: typeof row.host_run_again === "boolean" ? row.host_run_again : null,
    hostReviewedAt: stringFromValue(row.host_reviewed_at) ?? null,
    joinerRunAgain: typeof row.joiner_run_again === "boolean" ? row.joiner_run_again : null,
    joinerReviewedAt: stringFromValue(row.joiner_reviewed_at) ?? null,
    createdAt: stringFromValue(row.created_at) ?? new Date().toISOString(),
  };
}

export async function requestSpot(
  supabase: SB | null,
  args: {
    runId: string;
    profileId: string;
    requesterName: string;
    requesterWhatsapp: string;
    requesterSocials: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase client unavailable." };
  if (!args.requesterSocials.trim()) {
    return {
      ok: false,
      error: "Add a social link (Strava, Instagram, or Garmin) in your profile before requesting a spot.",
    };
  }
  if (!isValidSocialsUrl(args.requesterSocials)) {
    return {
      ok: false,
      error: "Your social link must be a Strava, Instagram, or Garmin URL.",
    };
  }

  const payload = {
    run_id: args.runId,
    user_id: args.profileId,
    status: "requested",
    requester_name: args.requesterName,
    requester_whatsapp: args.requesterWhatsapp,
    requester_socials: args.requesterSocials,
  };
  const { error } = await supabase.from("run_participants").insert(payload);
  if (!error) return { ok: true };

  if (error.code === "23505") {
    return { ok: false, error: "You've already requested this run." };
  }

  return { ok: false, error: error.message };
}

function toRunRow(row: Record<string, unknown>, fallbackCity: CitySlug): RunRow | null {
  const id = row.id != null ? String(row.id) : null;
  const lat = numberFromValue(row.location_lat);
  const lng = numberFromValue(row.location_lng);
  if (!id || lat == null || lng == null) return null;

  const startTime = stringFromValue(row.start_time) ?? legacyStartTime(row);
  if (!startTime) return null;

  const paceSeconds =
    numberFromValue(row.pace_seconds) ??
    secondsFromInterval(row.pace_min) ??
    315;
  const paceMin = formatPace(secondsFromInterval(row.pace_min) ?? Math.max(180, paceSeconds - 10));
  const paceMax = formatPace(secondsFromInterval(row.pace_max) ?? Math.min(480, paceSeconds + 10));
  const intent = normalizeIntent(stringFromValue(row.intent) ?? stringFromValue(row.goal));
  const cityValue = (stringFromValue(row.city) as CitySlug | undefined) ?? fallbackCity;

  return {
    id,
    city: cityValue,
    title: stringFromValue(row.title) ?? titleFromIntent(intent),
    description: stringFromValue(row.description) ?? null,
    locationName: stringFromValue(row.location_name) ?? "Local meeting point",
    lat,
    lng,
    startTime,
    paceSeconds,
    paceMin,
    paceMax,
    distanceKm: numberFromValue(row.distance_km) ?? 7,
    intent,
    organiserId: stringFromValue(row.organiser_id) ?? null,
    maxGroupSize: numberFromValue(row.max_group_size) ?? numberFromValue(row.spots_total) ?? 3,
    currentSpots: numberFromValue(row.current_spots) ?? numberFromValue(row.spots_taken) ?? 1,
    status: stringFromValue(row.status) ?? "active",
    recurrence: stringFromValue(row.recurrence) === "weekly" ? "weekly" : null,
    womenOnly: row.women_only === true,
  };
}

export function openSpots(run: Pick<RunRow, "maxGroupSize" | "currentSpots">) {
  return Math.max(0, run.maxGroupSize - run.currentSpots);
}

export function paceLabel(run: Pick<RunRow, "paceMin" | "paceMax">) {
  return `${run.paceMin}-${run.paceMax}`;
}

export type SocialsPlatform = "strava" | "instagram" | "garmin";

export function detectSocialsPlatform(url: string): SocialsPlatform | null {
  const v = url.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("strava.com") || v.includes("strava.app.link")) return "strava";
  if (v.includes("instagram.com") || v.includes("instagr.am")) return "instagram";
  if (v.includes("garmin.com")) return "garmin";
  return null;
}

// Turns a bare social handle into a full URL. If the input already points at
// a known platform (strava/instagram/garmin) it's returned untouched; a plain
// handle like "mikhail.zlochevskyi" or "@mikhail.zlochevskyi" is assumed to be
// Instagram and expanded to a profile URL. Anything else is returned as-is so
// validation can still reject it.
export function normalizeSocialsInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (detectSocialsPlatform(trimmed)) return trimmed;
  // Not a URL and not a known domain — treat a clean handle as Instagram.
  if (!/[\s/]/.test(trimmed) && !/^https?:/i.test(trimmed)) {
    const handle = trimmed.replace(/^@/, "");
    if (/^[a-zA-Z0-9._]{1,30}$/.test(handle)) {
      return `https://instagram.com/${handle}`;
    }
  }
  return trimmed;
}

export function isValidSocialsUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (!detectSocialsPlatform(trimmed)) return false;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    new URL(withProtocol);
    return true;
  } catch {
    return false;
  }
}

export function dayLabel(startTime: string) {
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

export function timeLabel(startTime: string) {
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function titleFromIntent(intent: RunIntent) {
  if (intent === "tempo") return "Tempo run";
  return "Social run";
}

function normalizeIntent(value?: string | null): RunIntent {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("tempo") || lower.includes("performance") || lower.includes("hill")) return "tempo";
  // Legacy "consistency" rows collapse into "social" so old data stays renderable.
  return "social";
}

function secondsToInterval(seconds: number) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `00:${mm}:${ss}`;
}

function secondsFromInterval(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const str = String(value).trim();
  if (!str) return null;
  const parts = str.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function formatPace(seconds: number) {
  const safe = Math.max(60, Math.round(seconds));
  const mm = Math.floor(safe / 60);
  const ss = (safe % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function numberFromValue(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringFromValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function legacyStartTime(row: Record<string, unknown>) {
  const date = stringFromValue(row.run_date);
  const time = stringFromValue(row.time);
  if (!date || !time) return undefined;
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}
