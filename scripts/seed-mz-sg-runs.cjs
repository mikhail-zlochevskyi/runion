#!/usr/bin/env node
/**
 * One-off seed: 5 Singapore runs hosted by mihailzlochevskiy@gmail.com,
 * across Sat 30 May and Sun 31 May 2026, one weekly-recurring.
 *
 * Usage:
 *   node scripts/seed-mz-sg-runs.cjs            # insert
 *   node scripts/seed-mz-sg-runs.cjs --reset    # delete these 5 again (by title+host)
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Runs are flagged is_seed=true so they bypass the open-runs cap and are
 * cleanly removable.
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

const HOST_EMAIL = "mihailzlochevskiy@gmail.com";

// SGT = UTC+8. Provide SGT wall-clock; we convert to a UTC instant.
function sgtToUtcIso(y, m, d, hh, mm) {
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0, 0)).toISOString();
}

// 5 popular Singapore running spots.
const RUNS = [
  {
    title: "Marina Bay sunrise loop",
    locationName: "Marina Bay Sands waterfront promenade",
    lat: 1.2839, lng: 103.8607,
    intent: "social", paceSeconds: 330, distanceKm: 6,
    note: "Easy waterfront loop, coffee at the end. New runners welcome.",
    sgt: [2026, 5, 30, 7, 0], // Sat 30 May, 07:00
    recurrence: null,
  },
  {
    title: "East Coast Park tempo",
    locationName: "East Coast Park (Area C, near Marine Cove)",
    lat: 1.3010, lng: 103.9120,
    intent: "tempo", paceSeconds: 285, distanceKm: 8,
    note: "Flat fast session along the coast. Bring water.",
    sgt: [2026, 5, 30, 18, 0], // Sat 30 May, 18:00
    recurrence: null,
  },
  {
    title: "MacRitchie trail social",
    locationName: "MacRitchie Reservoir Park entrance",
    lat: 1.3417, lng: 103.8160,
    intent: "social", paceSeconds: 360, distanceKm: 10,
    note: "Shaded trail loop at a chatty pace. Watch for monkeys.",
    sgt: [2026, 5, 31, 7, 30], // Sun 31 May, 07:30
    recurrence: null,
  },
  {
    title: "Botanic Gardens easy miles",
    locationName: "Singapore Botanic Gardens (Tanglin Gate)",
    lat: 1.3066, lng: 103.8158,
    intent: "social", paceSeconds: 345, distanceKm: 5,
    note: "Relaxed Sunday miles through the gardens. Repeats weekly.",
    sgt: [2026, 5, 31, 8, 0], // Sun 31 May, 08:00
    recurrence: "weekly", // the weekly repeat
  },
  {
    title: "Gardens by the Bay sunset",
    locationName: "Gardens by the Bay (Supertree Grove)",
    lat: 1.2816, lng: 103.8636,
    intent: "social", paceSeconds: 330, distanceKm: 6,
    note: "Golden-hour loop past the Supertrees. Photos encouraged.",
    sgt: [2026, 5, 31, 17, 30], // Sun 31 May, 17:30
    recurrence: null,
  },
];

function secondsToInterval(seconds) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `00:${mm}:${ss}`;
}

async function resolveHostId() {
  // Page through auth users to find the email.
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
    .in("title", titles)
    .select("id");
  if (error) throw error;
  console.log(`reset: deleted ${data?.length ?? 0} runs.`);
}

async function populate(hostId) {
  const rows = RUNS.map((r) => {
    const startIso = sgtToUtcIso(...r.sgt);
    const start = new Date(startIso);
    const paceMinSec = Math.max(180, r.paceSeconds - 10);
    const paceMaxSec = Math.min(480, r.paceSeconds + 10);
    return {
      title: r.title,
      description: r.note ?? null,
      pace_min: secondsToInterval(paceMinSec),
      pace_max: secondsToInterval(paceMaxSec),
      pace_seconds: r.paceSeconds,
      distance_km: r.distanceKm,
      start_time: startIso,
      location_name: r.locationName,
      intent: r.intent,
      created_by: hostId,
      organiser_id: hostId,
      max_group_size: 4,
      current_spots: 1,
      city: "sg",
      location: `POINT(${r.lng} ${r.lat})`,
      day: start.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Singapore" }).toUpperCase(),
      run_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(start),
      time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).format(start),
      goal: r.intent,
      spots_total: 4,
      spots_taken: 1,
      status: "active",
      recurrence: r.recurrence,
      is_seed: true,
    };
  });

  const { data, error } = await supabase.from("runs").insert(rows).select("id, title, start_time, recurrence");
  if (error) throw error;
  console.log(`populate: inserted ${data.length} SG runs for ${HOST_EMAIL}`);
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
  // Ensure a public.users profile row exists (organiser_id FK target).
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
  // Idempotent: clear any prior copies of these titles, then insert.
  await reset(hostId);
  await populate(hostId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
