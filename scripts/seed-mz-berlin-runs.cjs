#!/usr/bin/env node
/**
 * Seed 5 Berlin runs hosted by mzlochevskyi@gmail.com, spread across this week
 * and next week — to populate the newly-live Berlin city. One is weekly.
 *
 * Usage:
 *   node scripts/seed-mz-berlin-runs.cjs            # insert (idempotent by title+host)
 *   node scripts/seed-mz-berlin-runs.cjs --reset    # delete these again
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Runs are is_seed=true so they bypass the open-runs cap and are removable.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (!(k in process.env)) process.env[k] = vRaw.replace(/^"|"$/g, "");
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const HOST_EMAIL = "mzlochevskyi@gmail.com";
const CITY = "ber";
const TZ = "Europe/Berlin";
const OFFSET = 2; // CEST (summer, July) = UTC+2

// Local Berlin wall-clock -> UTC instant.
function localToUtcIso(y, m, d, hh, mm) {
  return new Date(Date.UTC(y, m - 1, d, hh - OFFSET, mm, 0, 0)).toISOString();
}
function startOfLocalDay() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function dateFromOffset(offDays) {
  const dt = new Date(startOfLocalDay().getTime() + offDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(dt).split("-").map(Number);
}

// 5 well-known Berlin running spots, spread this week + next.
const RUNS = [
  {
    title: "Tiergarten sunrise loop",
    locationName: "Tiergarten (Brandenburg Gate entrance)",
    lat: 52.5145, lng: 13.3501,
    intent: "social", paceSeconds: 330, distanceKm: 6,
    note: "Easy shaded loop through the park, coffee after. New runners welcome.",
    off: 1, hh: 7, mm: 30, recurrence: null,
  },
  {
    title: "Tempelhofer Feld tempo",
    locationName: "Tempelhofer Feld (Tempelhofer Damm gate)",
    lat: 52.4730, lng: 13.4050,
    intent: "tempo", paceSeconds: 300, distanceKm: 8,
    note: "Flat open runway for an honest tempo. Bring water.",
    off: 3, hh: 18, mm: 30, recurrence: null,
  },
  {
    title: "Landwehrkanal easy miles",
    locationName: "Landwehrkanal (Kreuzberg, Kottbusser Brücke)",
    lat: 52.4980, lng: 13.4180,
    intent: "social", paceSeconds: 345, distanceKm: 5,
    note: "Relaxed canal-side miles at a chatty pace. Repeats weekly.",
    off: 6, hh: 9, mm: 0, recurrence: "weekly",
  },
  {
    title: "Volkspark Friedrichshain loop",
    locationName: "Volkspark Friedrichshain (main entrance)",
    lat: 52.5280, lng: 13.4310,
    intent: "social", paceSeconds: 335, distanceKm: 6,
    note: "Rolling park loops, regroup at the top. Photos encouraged.",
    off: 9, hh: 8, mm: 0, recurrence: null,
  },
  {
    title: "Treptower Park riverside tempo",
    locationName: "Treptower Park (Spree riverside)",
    lat: 52.4870, lng: 13.4690,
    intent: "tempo", paceSeconds: 290, distanceKm: 10,
    note: "Faster session along the Spree. Warm up on your own first.",
    off: 12, hh: 18, mm: 0, recurrence: null,
  },
];

function secondsToInterval(seconds) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `00:${mm}:${ss}`;
}

async function resolveHostId() {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data?.users ?? []).find(
      (u) => (u.email ?? "").toLowerCase() === HOST_EMAIL.toLowerCase()
    );
    if (match) return match.id;
    if (!data || data.users.length < 200) break;
  }
  return null;
}

async function reset(hostId) {
  const titles = RUNS.map((r) => r.title);
  const { data, error } = await supabase
    .from("runs")
    .delete()
    .eq("organiser_id", hostId)
    .eq("city", CITY)
    .in("title", titles)
    .select("id");
  if (error) throw error;
  console.log(`reset: deleted ${data?.length ?? 0} runs.`);
}

async function populate(hostId) {
  const rows = RUNS.map((r) => {
    const [y, m, d] = dateFromOffset(r.off);
    const startIso = localToUtcIso(y, m, d, r.hh, r.mm);
    const start = new Date(startIso);
    return {
      title: r.title,
      description: r.note ?? null,
      pace_min: secondsToInterval(Math.max(180, r.paceSeconds - 10)),
      pace_max: secondsToInterval(Math.min(480, r.paceSeconds + 10)),
      pace_seconds: r.paceSeconds,
      distance_km: r.distanceKm,
      start_time: startIso,
      location_name: r.locationName,
      intent: r.intent,
      created_by: hostId,
      organiser_id: hostId,
      max_group_size: 4,
      current_spots: 1,
      city: CITY,
      location: `POINT(${r.lng} ${r.lat})`,
      day: start.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ }).toUpperCase(),
      run_date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(start),
      time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(start),
      goal: r.intent,
      spots_total: 4,
      spots_taken: 1,
      status: "active",
      recurrence: r.recurrence,
      women_only: false,
      is_seed: true,
    };
  });

  const { data, error } = await supabase.from("runs").insert(rows).select("id, title, start_time, recurrence");
  if (error) throw error;
  console.log(`populate: inserted ${data.length} Berlin runs for ${HOST_EMAIL}`);
  for (const r of data) {
    console.log(`  ${r.start_time}  ${r.title}${r.recurrence ? "  [weekly]" : ""}`);
  }
}

async function main() {
  const resetOnly = process.argv.includes("--reset");
  const hostId = await resolveHostId();
  if (!hostId) {
    console.error(`No auth user found for ${HOST_EMAIL}. They must have signed in at least once.`);
    process.exit(1);
  }
  const { data: profile } = await supabase.from("users").select("id, name").eq("id", hostId).maybeSingle();
  if (!profile) {
    console.error(`Auth user exists but no public.users profile row for ${HOST_EMAIL}. Complete onboarding first.`);
    process.exit(1);
  }
  console.log(`host: ${HOST_EMAIL} -> ${hostId} (${profile.name ?? "no name"})`);

  if (resetOnly) {
    await reset(hostId);
    return;
  }
  await reset(hostId); // idempotent
  await populate(hostId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
