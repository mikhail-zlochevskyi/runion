#!/usr/bin/env node
/**
 * Seed a full spread of run *variations* in every live city (BCN, SG, Berlin):
 * women's circle, long run, track intervals, tempo/speed, explore, easy/
 * recovery, hills, trail, sunrise social, progression. 10 variations x 3 cities
 * = 30 runs, each at a real local spot, with city-appropriate pace/distance/day.
 *
 * Usage:
 *   node scripts/seed-variations.cjs            # insert (idempotent by title+host)
 *   node scripts/seed-variations.cjs --reset    # delete this batch again
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Runs are is_seed=true so they bypass the open-runs cap and are removable.
 * Hosts are drawn round-robin from onboarded users; women-only runs prefer a
 * female host when one exists.
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

const WOMEN_HOST_EMAIL = "nitievskayaan@gmail.com"; // preferred host for women-only runs
const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const TZ = { sg: "Asia/Singapore", bcn: "Europe/Madrid", ber: "Europe/Berlin" };

// paceSeconds per km. intent is the schema enum (tempo|social); `label` is the
// human variation name used in the title.
const VARIATIONS = [
  { key: "women",       label: "Women's Circle",  intent: "social", distance: 6,  pace: 350, womenOnly: true,  recurring: true,  day: "SAT", time: "08:00", group: 6, note: "Women-only easy loop at a social pace. Coffee after — all levels welcome." },
  { key: "long",        label: "Long Run",        intent: "social", distance: 18, pace: 340, womenOnly: false, recurring: true,  day: "SUN", time: "07:00", group: 4, note: "Steady weekend long run. Bring water + gels, we regroup at turnarounds." },
  { key: "intervals",   label: "Track Intervals", intent: "tempo",  distance: 8,  pace: 270, womenOnly: false, recurring: true,  day: "TUE", time: "18:30", group: 8, note: "Structured reps (e.g. 6x800m) with jog recoveries. Warm up on your own first." },
  { key: "tempo",       label: "Tempo",           intent: "tempo",  distance: 7,  pace: 285, womenOnly: false, recurring: true,  day: "THU", time: "06:30", group: 4, note: "Honest threshold effort, continuous. Bring water, easy cooldown together." },
  { key: "explore",     label: "Explore",         intent: "social", distance: 9,  pace: 335, womenOnly: false, recurring: false, day: "SAT", time: "09:00", group: 5, note: "Discovery run on a new route — chatty pace, photo stops encouraged." },
  { key: "easy",        label: "Easy Miles",      intent: "social", distance: 5,  pace: 360, womenOnly: false, recurring: true,  day: "WED", time: "07:00", group: 6, note: "Relaxed recovery miles, nobody dropped. Great for a first group run." },
  { key: "hills",       label: "Hill Reps",       intent: "tempo",  distance: 8,  pace: 310, womenOnly: false, recurring: false, day: "SUN", time: "08:30", group: 6, note: "Repeats up the climb, jog down to recover. Strength session, not a race." },
  { key: "trail",       label: "Trail",           intent: "social", distance: 12, pace: 345, womenOnly: false, recurring: false, day: "SAT", time: "07:30", group: 4, note: "Shaded trail loop at a conversational pace. Trail shoes recommended." },
  { key: "sunrise",     label: "Sunrise Social",  intent: "social", distance: 6,  pace: 330, womenOnly: false, recurring: true,  day: "FRI", time: "06:00", group: 6, note: "Golden-hour easy run to start the day. Coffee stop after." },
  { key: "progression", label: "Progression",     intent: "tempo",  distance: 10, pace: 300, womenOnly: false, recurring: false, day: "MON", time: "07:00", group: 5, note: "Start easy, finish fast — each km a touch quicker than the last." },
];

// Real local start points per city, index-aligned to VARIATIONS so the terrain
// fits the session (track for intervals, trails for trail, a climb for hills).
const SPOTS = {
  sg: [
    { name: "Botanic Gardens (Tanglin Gate)", lat: 1.3138, lng: 103.8159 },
    { name: "East Coast Park (Big Splash)", lat: 1.3015, lng: 103.912 },
    { name: "Kallang Practice Track", lat: 1.303, lng: 103.872 },
    { name: "Marina Bay (Helix Bridge)", lat: 1.2818, lng: 103.8636 },
    { name: "Punggol Waterway → Coney Island", lat: 1.3984, lng: 103.9072 },
    { name: "Bishan-Ang Mo Kio Park", lat: 1.352, lng: 103.848 },
    { name: "Mount Faber (Southern Ridges)", lat: 1.2784, lng: 103.8219 },
    { name: "MacRitchie Reservoir (Venus Drive)", lat: 1.3414, lng: 103.833 },
    { name: "Gardens by the Bay (Supertree Grove)", lat: 1.2816, lng: 103.8636 },
    { name: "Sentosa (Siloso Beach)", lat: 1.2494, lng: 103.8303 },
  ],
  bcn: [
    { name: "Parc de la Ciutadella (Arc de Triomf)", lat: 41.3863, lng: 2.1862 },
    { name: "Barceloneta (Passeig Marítim)", lat: 41.3785, lng: 2.1925 },
    { name: "Estadi Joan Serrahima (Montjuïc track)", lat: 41.3706, lng: 2.1545 },
    { name: "Diagonal (Plaça Francesc Macià)", lat: 41.392, lng: 2.14 },
    { name: "Poblenou → Fòrum → Besòs", lat: 41.4057, lng: 2.2017 },
    { name: "Turó Park", lat: 41.3936, lng: 2.1387 },
    { name: "Montjuïc (Plaça Espanya climb)", lat: 41.373, lng: 2.149 },
    { name: "Collserola (Tibidabo)", lat: 41.4219, lng: 2.119 },
    { name: "Port Olímpic", lat: 41.387, lng: 2.196 },
    { name: "Carretera de les Aigües", lat: 41.4183, lng: 2.1245 },
  ],
  ber: [
    { name: "Volkspark Friedrichshain", lat: 52.528, lng: 13.431 },
    { name: "Tiergarten (Brandenburg Gate)", lat: 52.5145, lng: 13.3501 },
    { name: "Friedrich-Ludwig-Jahn-Sportpark (track)", lat: 52.545, lng: 13.403 },
    { name: "Tempelhofer Feld", lat: 52.473, lng: 13.405 },
    { name: "Museumsinsel → East Side Gallery", lat: 52.5195, lng: 13.401 },
    { name: "Landwehrkanal (Kreuzberg)", lat: 52.498, lng: 13.418 },
    { name: "Viktoriapark (Kreuzberg climb)", lat: 52.488, lng: 13.381 },
    { name: "Grunewald (Teufelsberg)", lat: 52.49, lng: 13.241 },
    { name: "Mauerpark", lat: 52.5416, lng: 13.402 },
    { name: "Treptower Park (Spree)", lat: 52.487, lng: 13.469 },
  ],
};

const SHORT = {
  sg: "SG", bcn: "BCN", ber: "Berlin",
};

function secondsToInterval(seconds) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `00:${mm}:${ss}`;
}

// Convert a wall-clock time in an IANA zone to a UTC ISO string, DST-correct.
function zonedToUtc(tz, y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === "24" ? 0 : p.hour), +p.minute);
  const offset = asUtc - guess; // ms the zone is ahead of UTC
  return new Date(guess - offset).toISOString();
}

// Next upcoming calendar date (in the city tz) for a weekday like "SAT".
// If that weekday is today, push to next week to guarantee a future run.
function nextDateFor(tz, dayName) {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // YYYY-MM-DD
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" })
    .format(now).toUpperCase().slice(0, 3);
  let delta = (DOW[dayName] - DOW[wd] + 7) % 7;
  if (delta === 0) delta = 7;
  const target = new Date(Date.UTC(ty, tm - 1, td) + delta * 86400000);
  return [target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate()];
}

function titleFor(variation, spot) {
  const place = spot.name.split(" (")[0].split(" →")[0];
  return `${variation.label} · ${place}`;
}

async function fetchHosts() {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, name, onboarding_completed");
  if (error) throw error;
  const hosts = (data || []).filter((u) => u.onboarding_completed);
  if (!hosts.length) throw new Error("No onboarded users to host seed runs.");
  const womenHost = hosts.find((h) => (h.email || "").toLowerCase() === WOMEN_HOST_EMAIL) || hosts[0];
  return { hosts, womenHost };
}

function buildRows({ hosts, womenHost }) {
  const rows = [];
  let rr = 0;
  for (const city of Object.keys(SPOTS)) {
    const tz = TZ[city];
    VARIATIONS.forEach((v, i) => {
      const spot = SPOTS[city][i];
      const host = v.womenOnly ? womenHost : hosts[rr++ % hosts.length];
      const [y, m, d] = nextDateFor(tz, v.day);
      const [hh, mm] = v.time.split(":").map(Number);
      const startIso = zonedToUtc(tz, y, m, d, hh, mm);
      const start = new Date(startIso);
      rows.push({
        title: titleFor(v, spot),
        description: v.note,
        pace_min: secondsToInterval(Math.max(180, v.pace - 15)),
        pace_max: secondsToInterval(Math.min(480, v.pace + 15)),
        pace_seconds: v.pace,
        distance_km: v.distance,
        start_time: startIso,
        location_name: spot.name,
        intent: v.intent,
        created_by: host.id,
        organiser_id: host.id,
        max_group_size: v.group,
        current_spots: 1,
        city,
        location: `POINT(${spot.lng} ${spot.lat})`,
        day: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(start).toUpperCase(),
        run_date: new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(start),
        time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(start),
        goal: v.intent,
        spots_total: v.group,
        spots_taken: 1,
        status: "active",
        recurrence: v.recurring ? "weekly" : null,
        women_only: v.womenOnly,
        is_seed: true,
      });
    });
  }
  return rows;
}

function allTitles(hosts) {
  // Titles are deterministic from variation+spot, independent of host.
  const titles = [];
  for (const city of Object.keys(SPOTS)) {
    VARIATIONS.forEach((v, i) => titles.push(titleFor(v, SPOTS[city][i])));
  }
  return titles;
}

async function reset() {
  const titles = allTitles();
  const { data, error } = await supabase
    .from("runs")
    .delete()
    .eq("is_seed", true)
    .in("title", titles)
    .select("id");
  if (error) throw error;
  console.log(`reset: deleted ${data?.length ?? 0} variation runs.`);
}

async function main() {
  const resetOnly = process.argv.includes("--reset");
  if (resetOnly) {
    await reset();
    return;
  }
  const hostInfo = await fetchHosts();
  console.log(`hosts: ${hostInfo.hosts.length} (women-only → ${hostInfo.womenHost.name || hostInfo.womenHost.email})`);
  await reset(); // idempotent
  const rows = buildRows(hostInfo);
  const { data, error } = await supabase.from("runs").insert(rows).select("id, city, women_only, recurrence");
  if (error) throw error;
  const byCity = {};
  let women = 0, weekly = 0;
  for (const r of data) {
    byCity[r.city] = (byCity[r.city] || 0) + 1;
    if (r.women_only) women++;
    if (r.recurrence === "weekly") weekly++;
  }
  console.log(`inserted ${data.length} runs (${Object.entries(byCity).map(([c, n]) => `${c}:${n}`).join(", ")}); ${women} women-only, ${weekly} weekly, ${data.length - weekly} one-off.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
