import type { CitySlug } from "@/lib/types";
import type { createClient } from "@/lib/supabase/client";

export type RunIntent = "tempo" | "social" | "consistency";

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
  maxGroupSize: number;
  currentSpots: number;
  status: string;
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
};

type SB = NonNullable<ReturnType<typeof createClient>>;

const FETCH_COLUMNS =
  "id, city, title, description, location_name, location_lat, location_lng, start_time, run_date, time, pace_seconds, pace_min, pace_max, distance_km, intent, goal, organiser_id, max_group_size, current_spots, spots_total, spots_taken, status";

export async function fetchOpenRuns(
  supabase: SB | null,
  opts: { city: CitySlug; lat?: number; lng?: number; radiusM?: number }
): Promise<RunRow[]> {
  if (!supabase) return [];
  const { city, lat, lng, radiusM = 2000 } = opts;

  if (typeof lat === "number" && typeof lng === "number") {
    const rpc = await supabase.rpc("runs_nearby", {
      user_lat: lat,
      user_lng: lng,
      radius_m: radiusM,
      requested_city: city,
    });
    if (!rpc.error && Array.isArray(rpc.data)) {
      return rpc.data
        .map((row) => toRunRow(row as Record<string, unknown>, city))
        .filter((row): row is RunRow => Boolean(row));
    }
  }

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
  return data
    .map((row) => toRunRow(row as Record<string, unknown>, city))
    .filter((row): row is RunRow => Boolean(row));
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
  const paceMinSec = Math.max(270, input.paceSeconds - 10);
  const paceMaxSec = Math.min(450, input.paceSeconds + 10);
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
  };

  const { data, error } = await supabase.from("runs").insert(payload).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id as string | undefined };
}

export type ParticipantStatus = "requested" | "confirmed" | "declined";

export type ParticipantRow = {
  id: string;
  runId: string;
  userId: string;
  status: ParticipantStatus;
  requesterName: string | null;
  requesterWhatsapp: string | null;
  requesterSocials: string | null;
  createdAt: string;
};

export type MyActivity = {
  pending: { participant: ParticipantRow; run: RunRow }[];
  confirmed: { participant: ParticipantRow; run: RunRow }[];
  hosted: {
    run: RunRow;
    pending: ParticipantRow[];
    confirmed: ParticipantRow[];
  }[];
};

export async function fetchMyActivity(
  supabase: SB | null,
  args: { profileId: string }
): Promise<MyActivity> {
  if (!supabase) return { pending: [], confirmed: [], hosted: [] };
  const { profileId } = args;

  const [participantResult, hostedResult] = await Promise.all([
    supabase
      .from("run_participants")
      .select(`id, run_id, user_id, status, requester_name, requester_whatsapp, requester_socials, created_at, run:runs(${FETCH_COLUMNS})`)
      .eq("user_id", profileId)
      .in("status", ["requested", "confirmed"]),
    supabase
      .from("runs")
      .select(FETCH_COLUMNS)
      .eq("organiser_id", profileId)
      .in("status", ["active", "full"]),
  ]);

  const pending: { participant: ParticipantRow; run: RunRow }[] = [];
  const confirmed: { participant: ParticipantRow; run: RunRow }[] = [];

  if (!participantResult.error && participantResult.data) {
    for (const row of participantResult.data as Record<string, unknown>[]) {
      const runRaw = row.run as Record<string, unknown> | null;
      if (!runRaw) continue;
      const run = toRunRow(runRaw, (runRaw.city as CitySlug) ?? "bcn");
      if (!run) continue;
      const participant = toParticipantRow(row);
      if (!participant) continue;
      if (participant.status === "requested") pending.push({ participant, run });
      else if (participant.status === "confirmed") confirmed.push({ participant, run });
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
      .select("id, run_id, user_id, status, requester_name, requester_whatsapp, requester_socials, created_at")
      .in("run_id", ids);
    if (!error && data) {
      hostedRequests = (data as Record<string, unknown>[])
        .map(toParticipantRow)
        .filter((p): p is ParticipantRow => Boolean(p));
    }
  }

  const hosted = hostedRuns.map((run) => {
    const requests = hostedRequests.filter((r) => r.runId === run.id);
    return {
      run,
      pending: requests.filter((r) => r.status === "requested"),
      confirmed: requests.filter((r) => r.status === "confirmed"),
    };
  });

  return { pending, confirmed, hosted };
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
  const paceMin = formatPace(secondsFromInterval(row.pace_min) ?? Math.max(270, paceSeconds - 10));
  const paceMax = formatPace(secondsFromInterval(row.pace_max) ?? Math.min(450, paceSeconds + 10));
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
  if (v.includes("strava.com")) return "strava";
  if (v.includes("instagram.com")) return "instagram";
  if (v.includes("garmin.com")) return "garmin";
  return null;
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
  if (intent === "consistency") return "Consistency run";
  return "Social run";
}

function normalizeIntent(value?: string | null): RunIntent {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("tempo") || lower.includes("performance") || lower.includes("hill")) return "tempo";
  if (lower.includes("consistent") || lower.includes("steady")) return "consistency";
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
