#!/usr/bin/env node
/**
 * Seed 3 runs for every user profile, spread across this week and next week.
 * Each host's runs land in their home city (inferred from their existing runs,
 * default BCN). Anastasia's runs are flagged women-only.
 *
 * Usage:
 *   node scripts/seed-weekly-runs.cjs            # insert (idempotent for this batch)
 *   node scripts/seed-weekly-runs.cjs --reset    # delete this batch again
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Runs are is_seed=true so they bypass the open-runs cap and are removable.
 * The batch owns three specific run_dates (see DAY_OFFSETS) — reset only
 * touches seed runs on those dates by these hosts, leaving other seeds alone.
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

// Hosts whose runs are women-only, by email (lowercased).
const WOMEN_ONLY_HOSTS = new Set(["nitievskayaan@gmail.com"]);

// Days from "today" (local) for the 3 runs: two this week, one next week.
const DAY_OFFSETS = [2, 5, 9];
// Local wall-clock start times per run index, and their varied shape.
const SLOTS = [
  { hh: 7, mm: 0, intent: "social", distance: 6 },
  { hh: 18, mm: 30, intent: "tempo", distance: 8 },
  { hh: 8, mm: 0, intent: "social", distance: 5 },
];

// City meta: summer UTC offset (Jul), plus a rotating pool of start points.
const CITIES = {
  sg: {
    tz: "Asia/Singapore",
    offset: 8,
    spots: [
      { name: "Marina Bay Sands waterfront promenade", lat: 1.2839, lng: 103.8607 },
      { name: "East Coast Park (Area C, near Marine Cove)", lat: 1.301, lng: 103.912 },
      { name: "MacRitchie Reservoir Park entrance", lat: 1.3417, lng: 103.816 },
      { name: "Singapore Botanic Gardens (Tanglin Gate)", lat: 1.3066, lng: 103.8158 },
      { name: "Kallang Riverside Park", lat: 1.3036, lng: 103.8718 },
      { name: "Bishan-Ang Mo Kio Park", lat: 1.3620, lng: 103.8480 },
    ],
  },
  bcn: {
    tz: "Europe/Madrid",
    offset: 2,
    spots: [
      { name: "Barceloneta beach boardwalk", lat: 41.3784, lng: 2.1925 },
      { name: "Parc de la Ciutadella (main gate)", lat: 41.3881, lng: 2.1879 },
      { name: "Carretera de les Aigües (Peu del Funicular)", lat: 41.4183, lng: 2.1245 },
      { name: "Parc del Fòrum esplanade", lat: 41.4103, lng: 2.2277 },
      { name: "Turó Park", lat: 41.3936, lng: 2.1387 },
      { name: "Passeig Marítim (Port Olímpic)", lat: 41.3865, lng: 2.1969 },
    ],
  },
};

const TITLES = {
  social: ["easy social miles", "chatty recovery loop", "coffee-run social", "sunrise cruise", "golden-hour loop"],
  tempo: ["tempo session", "threshold intervals", "steady tempo push", "progression run", "fartlek blocks"],
};
const NOTES = {
  social: [
    "Relaxed pace, coffee after. New runners welcome.",
    "Chatty effort — nobody dropped. Bring water.",
    "Easy conversational miles, flat route.",
  ],
  tempo: [
    "Honest tempo effort. Warm up on your own first.",
    "Faster session — bring water, we regroup at the end.",
    "Structured intervals then an easy cooldown.",
  ],
};

function secondsToInterval(seconds) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `00:${mm}:${ss}`;
}

// Local wall-clock (with the city's fixed summer offset) -> UTC instant.
function localToUtcIso(offset, y, m, d, hh, mm) {
  return new Date(Date.UTC(y, m - 1, d, hh - offset, mm, 0, 0)).toISOString();
}

function startOfLocalDay() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function fetchHosts() {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, name, email, comfortable_pace_seconds_per_km");
  if (error) throw error;
  const { data: runs } = await supabase.from("runs").select("organiser_id, city");
  const cityByHost = {};
  for (const r of runs || []) {
    if (!r.organiser_id) continue;
    cityByHost[r.organiser_id] = cityByHost[r.organiser_id] || {};
    cityByHost[r.organiser_id][r.city] = (cityByHost[r.organiser_id][r.city] || 0) + 1;
  }
  return (users || []).map((u) => {
    const counts = cityByHost[u.id] || {};
    const city = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "bcn";
    return { ...u, city: city === "sg" ? "sg" : "bcn" };
  });
}

function buildRows(host, hostIndex, targetDates) {
  const cityMeta = CITIES[host.city];
  const basePace = host.comfortable_pace_seconds_per_km || 330;
  const womenOnly = WOMEN_ONLY_HOSTS.has((host.email || "").toLowerCase());
  const paceDeltas = [-10, 15, 0];

  return SLOTS.map((slot, i) => {
    const [y, m, d] = targetDates[i];
    const startIso = localToUtcIso(cityMeta.offset, y, m, d, slot.hh, slot.mm);
    const start = new Date(startIso);
    const pace = Math.min(480, Math.max(180, basePace + paceDeltas[i]));
    const spot = cityMeta.spots[(hostIndex + i) % cityMeta.spots.length];
    const titlePool = TITLES[slot.intent];
    const title = `${spot.name.split(" (")[0].split(" —")[0]} ${titlePool[(hostIndex + i) % titlePool.length]}`;
    const note = NOTES[slot.intent][(hostIndex + i) % NOTES[slot.intent].length];

    return {
      title,
      description: note,
      pace_min: secondsToInterval(Math.max(180, pace - 10)),
      pace_max: secondsToInterval(Math.min(480, pace + 10)),
      pace_seconds: pace,
      distance_km: slot.distance,
      start_time: startIso,
      location_name: spot.name,
      intent: slot.intent,
      created_by: host.id,
      organiser_id: host.id,
      max_group_size: 4,
      current_spots: 1,
      city: host.city,
      location: `POINT(${spot.lng} ${spot.lat})`,
      day: start.toLocaleDateString("en-US", { weekday: "short", timeZone: cityMeta.tz }).toUpperCase(),
      run_date: new Intl.DateTimeFormat("en-CA", { timeZone: cityMeta.tz }).format(start),
      time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: cityMeta.tz }).format(start),
      goal: slot.intent,
      spots_total: 4,
      spots_taken: 1,
      status: "active",
      recurrence: null,
      women_only: womenOnly,
      is_seed: true,
    };
  });
}

function targetDatesFor(city) {
  // Compute the local calendar Y/M/D for each offset, in the city's tz.
  const base = startOfLocalDay();
  return DAY_OFFSETS.map((off) => {
    const dt = new Date(base.getTime() + off * 86400000);
    const s = new Intl.DateTimeFormat("en-CA", { timeZone: CITIES[city].tz }).format(dt);
    return s.split("-").map(Number); // [y, m, d]
  });
}

async function resetBatch(hosts) {
  // The batch owns specific run_dates per city; delete only those seed runs.
  let deleted = 0;
  for (const host of hosts) {
    const dates = targetDatesFor(host.city).map((ymd) => ymd.map((n, i) => (i === 0 ? n : String(n).padStart(2, "0"))).join("-"));
    const { data, error } = await supabase
      .from("runs")
      .delete()
      .eq("organiser_id", host.id)
      .eq("is_seed", true)
      .in("run_date", dates)
      .select("id");
    if (error) throw error;
    deleted += data?.length ?? 0;
  }
  console.log(`reset: deleted ${deleted} batch runs.`);
}

async function main() {
  const resetOnly = process.argv.includes("--reset");
  const hosts = await fetchHosts();
  console.log(`hosts: ${hosts.length}`);

  if (resetOnly) {
    await resetBatch(hosts);
    return;
  }

  await resetBatch(hosts); // idempotent for this batch

  const allRows = [];
  hosts.forEach((host, idx) => {
    const dates = targetDatesFor(host.city);
    allRows.push(...buildRows(host, idx, dates));
  });

  const { data, error } = await supabase.from("runs").insert(allRows).select("id, organiser_id, city, women_only");
  if (error) throw error;

  const byCity = {};
  let womenOnly = 0;
  for (const r of data) {
    byCity[r.city] = (byCity[r.city] || 0) + 1;
    if (r.women_only) womenOnly += 1;
  }
  console.log(`inserted ${data.length} runs (${Object.entries(byCity).map(([c, n]) => `${c}:${n}`).join(", ")}), ${womenOnly} women-only.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
