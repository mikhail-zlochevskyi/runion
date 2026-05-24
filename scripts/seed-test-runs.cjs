#!/usr/bin/env node
/**
 * Seed test runs for SG and BCN — varied neighbourhoods, paces, intents.
 *
 * Usage:
 *   node scripts/seed-test-runs.cjs              # reset then populate
 *   node scripts/seed-test-runs.cjs --reset      # only delete seed rows
 *   node scripts/seed-test-runs.cjs --populate   # only populate (no reset)
 *   node scripts/seed-test-runs.cjs --drain      # send queued seed-join alerts via edge function
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * All seeded runs are flagged is_seed=true. The companion DB trigger
 * (migration 0013) queues a notification_jobs row on every join; --drain
 * invokes the seed-join-notify edge function to send those alerts to
 * mzlochevskyi@gmail.com.
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
    const v = vRaw.replace(/^"|"$/g, "");
    if (!(k in process.env)) process.env[k] = v;
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

const SEED_HOST_EMAIL = "seed-host@runion.local";
const SEED_HOST_PASSWORD = "seedrunner1!";
const SEED_HOST_NAME = "Seed Host";

const RUN_CONFIGS = [
  // ── Barcelona — 7 varied runs ─────────────────────────────────────────
  {
    city: "bcn",
    title: "Barceloneta sunrise",
    locationName: "Barceloneta boardwalk",
    lat: 41.3789, lng: 2.1899,
    intent: "social", paceSeconds: 330, distanceKm: 6,
    startOffsetHours: 14, // tomorrow 7am roughly
  },
  {
    city: "bcn",
    title: "Ciutadella loop",
    locationName: "Parc de la Ciutadella",
    lat: 41.3851, lng: 2.1864,
    intent: "social", paceSeconds: 345, distanceKm: 5,
    startOffsetHours: 38,
  },
  {
    city: "bcn",
    title: "Montjuïc climb",
    locationName: "Plaça d'Espanya",
    lat: 41.3717, lng: 2.1486,
    intent: "tempo", paceSeconds: 285, distanceKm: 8,
    startOffsetHours: 30,
  },
  {
    city: "bcn",
    title: "Diagonal Mar tempo",
    locationName: "Parc Diagonal Mar",
    lat: 41.4099, lng: 2.2188,
    intent: "tempo", paceSeconds: 270, distanceKm: 7,
    startOffsetHours: 56,
  },
  {
    city: "bcn",
    title: "Gràcia easy miles",
    locationName: "Plaça del Sol, Gràcia",
    lat: 41.4030, lng: 2.1556,
    intent: "social", paceSeconds: 360, distanceKm: 5,
    startOffsetHours: 80,
  },
  {
    city: "bcn",
    title: "Carretera de les Aigües",
    locationName: "Carretera de les Aigües trailhead",
    lat: 41.4233, lng: 2.1158,
    intent: "social", paceSeconds: 315, distanceKm: 10,
    startOffsetHours: 104,
  },
  {
    city: "bcn",
    title: "Sant Martí evening",
    locationName: "Parc del Centre del Poblenou",
    lat: 41.4081, lng: 2.1976,
    intent: "social", paceSeconds: 340, distanceKm: 6,
    startOffsetHours: 26,
  },
  // ── Singapore — 7 varied runs ─────────────────────────────────────────
  {
    city: "sg",
    title: "Marina Bay loop",
    locationName: "Marina Bay Sands waterfront",
    lat: 1.2839, lng: 103.8607,
    intent: "social", paceSeconds: 330, distanceKm: 6,
    startOffsetHours: 22,
  },
  {
    city: "sg",
    title: "East Coast tempo",
    locationName: "East Coast Park Area F",
    lat: 1.3038, lng: 103.9134,
    intent: "tempo", paceSeconds: 280, distanceKm: 8,
    startOffsetHours: 46,
  },
  {
    city: "sg",
    title: "Bukit Timah trail",
    locationName: "Bukit Timah Nature Reserve",
    lat: 1.3536, lng: 103.7763,
    intent: "social", paceSeconds: 360, distanceKm: 7,
    startOffsetHours: 70,
  },
  {
    city: "sg",
    title: "Bishan-AMK Park",
    locationName: "Bishan-Ang Mo Kio Park",
    lat: 1.3614, lng: 103.8482,
    intent: "social", paceSeconds: 345, distanceKm: 5,
    startOffsetHours: 34,
  },
  {
    city: "sg",
    title: "MacRitchie reservoir",
    locationName: "MacRitchie Reservoir Park",
    lat: 1.3415, lng: 103.8259,
    intent: "social", paceSeconds: 330, distanceKm: 10,
    startOffsetHours: 96,
  },
  {
    city: "sg",
    title: "Sentosa boardwalk",
    locationName: "Sentosa Boardwalk",
    lat: 1.2604, lng: 103.8221,
    intent: "social", paceSeconds: 350, distanceKm: 5,
    startOffsetHours: 58,
  },
  {
    city: "sg",
    title: "Kallang river tempo",
    locationName: "Kallang Riverside Park",
    lat: 1.3030, lng: 103.8730,
    intent: "tempo", paceSeconds: 295, distanceKm: 8,
    startOffsetHours: 28,
  },
];

function secondsToInterval(seconds) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `00:${mm}:${ss}`;
}

async function ensureSeedHost() {
  // Look for existing auth user.
  const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  let user = existing?.users?.find((u) => u.email === SEED_HOST_EMAIL);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: SEED_HOST_EMAIL,
      password: SEED_HOST_PASSWORD,
      email_confirm: true,
      user_metadata: { name: SEED_HOST_NAME },
    });
    if (error) throw new Error(`Could not create seed host: ${error.message}`);
    user = data.user;
  }
  if (!user) throw new Error("No seed host user");

  await supabase.from("users").upsert({
    id: user.id,
    email: SEED_HOST_EMAIL,
    name: SEED_HOST_NAME,
    runner_type: "consistent",
    comfortable_pace_seconds_per_km: 315,
    comfortable_pace_min_seconds_per_km: 300,
    comfortable_pace_max_seconds_per_km: 330,
    run_intents: ["consistency"],
    availability: ["morning"],
    preferred_group_size: "two_to_three",
    whatsapp: "+0000000000",
    socials_url: "https://www.strava.com/athletes/runion-seed",
    onboarding_completed: true,
  });

  return user.id;
}

async function reset() {
  // Delete seeded runs; cascades to run_participants. Also clear queued
  // alert jobs so the next drain doesn't re-fire stale notifications.
  const { data: seeded, error: selErr } = await supabase
    .from("runs")
    .select("id")
    .eq("is_seed", true);
  if (selErr) throw selErr;
  const ids = (seeded ?? []).map((r) => r.id);
  if (ids.length) {
    await supabase.from("notification_jobs").delete().in("run_id", ids);
    const { error: delErr } = await supabase.from("runs").delete().in("id", ids);
    if (delErr) throw delErr;
    console.log(`reset: deleted ${ids.length} seeded runs.`);
  } else {
    console.log("reset: no seeded runs to delete.");
  }
}

function startTimeFromOffset(hours) {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + hours, 0, 0, 0);
  return d;
}

async function populate(hostId) {
  const rows = RUN_CONFIGS.map((cfg) => {
    const start = startTimeFromOffset(cfg.startOffsetHours);
    const runDate = start.toISOString().slice(0, 10);
    const time = start.toISOString().slice(11, 16);
    const day = start.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    const paceMinSec = Math.max(180, cfg.paceSeconds - 10);
    const paceMaxSec = Math.min(480, cfg.paceSeconds + 10);
    return {
      title: cfg.title,
      description: null,
      pace_min: secondsToInterval(paceMinSec),
      pace_max: secondsToInterval(paceMaxSec),
      pace_seconds: cfg.paceSeconds,
      distance_km: cfg.distanceKm,
      start_time: start.toISOString(),
      location_name: cfg.locationName,
      intent: cfg.intent,
      created_by: hostId,
      organiser_id: hostId,
      max_group_size: 3,
      current_spots: 1,
      city: cfg.city,
      location: `POINT(${cfg.lng} ${cfg.lat})`,
      day,
      run_date: runDate,
      time,
      goal: cfg.intent,
      spots_total: 3,
      spots_taken: 1,
      status: "active",
      is_seed: true,
    };
  });

  const { data, error } = await supabase.from("runs").insert(rows).select("id, city, title");
  if (error) throw error;
  console.log(`populate: inserted ${data.length} runs`);
  for (const r of data) {
    console.log(`  ${r.city.toUpperCase()}  ${r.title}`);
  }
}

async function drain() {
  const fnUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/seed-join-notify`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const body = await res.text();
  console.log(`drain: ${res.status} ${body}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const resetOnly = args.has("--reset");
  const populateOnly = args.has("--populate");
  const drainOnly = args.has("--drain");

  if (drainOnly) {
    await drain();
    return;
  }

  if (!populateOnly) await reset();
  if (resetOnly) return;

  const hostId = await ensureSeedHost();
  await populate(hostId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
