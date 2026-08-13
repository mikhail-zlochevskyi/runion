#!/usr/bin/env node
/**
 * One-off seed: Barcelona runs for two hosts across Sat 30 / Sun 31 May 2026.
 *   - kobvel@gmail.com        : 3 runs
 *   - nitievskayaan@gmail.com : 3 runs, women-only
 *
 * Usage:
 *   node scripts/seed-bcn-runs.cjs            # insert (idempotent per title+host)
 *   node scripts/seed-bcn-runs.cjs --reset    # delete these runs again
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Runs are flagged is_seed=true (bypass open-runs cap, cleanly removable).
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

// Barcelona is UTC+2 (CEST) in May. Convert a local wall-clock to a UTC instant.
function bcnToUtcIso(y, m, d, hh, mm) {
  return new Date(Date.UTC(y, m - 1, d, hh - 2, mm, 0, 0)).toISOString();
}

const HOSTS = [
  {
    email: "kobvel@gmail.com",
    womenOnly: false,
    runs: [
      {
        title: "Barceloneta sunrise loop",
        locationName: "Barceloneta boardwalk",
        lat: 41.3789, lng: 2.1899,
        intent: "social", paceSeconds: 330, distanceKm: 6,
        note: "Easy seafront loop to start the weekend. Coffee after.",
        bcn: [2026, 5, 30, 8, 0], // Sat 30 May, 08:00
      },
      {
        title: "Ciutadella evening miles",
        locationName: "Parc de la Ciutadella",
        lat: 41.3851, lng: 2.1864,
        intent: "social", paceSeconds: 345, distanceKm: 5,
        note: "Relaxed laps around the park. All paces welcome.",
        bcn: [2026, 5, 30, 18, 30], // Sat 30 May, 18:30
      },
      {
        title: "Carretera de les Aigües",
        locationName: "Carretera de les Aigües trailhead",
        lat: 41.4233, lng: 2.1158,
        intent: "tempo", paceSeconds: 300, distanceKm: 10,
        note: "Hill views and a steady tempo above the city.",
        bcn: [2026, 5, 31, 9, 0], // Sun 31 May, 09:00
      },
    ],
  },
  {
    email: "nitievskayaan@gmail.com",
    womenOnly: true,
    runs: [
      {
        title: "Montjuïc morning (women only)",
        locationName: "Plaça d'Espanya",
        lat: 41.3717, lng: 2.1486,
        intent: "social", paceSeconds: 345, distanceKm: 7,
        note: "Women-only climb up Montjuïc at a chatty pace.",
        bcn: [2026, 5, 30, 9, 0], // Sat 30 May, 09:00
      },
      {
        title: "Poblenou easy miles (women only)",
        locationName: "Parc del Centre del Poblenou",
        lat: 41.4081, lng: 2.1976,
        intent: "social", paceSeconds: 360, distanceKm: 5,
        note: "Gentle women-only Sunday miles. New runners welcome.",
        bcn: [2026, 5, 31, 8, 30], // Sun 31 May, 08:30
      },
      {
        title: "Diagonal Mar sunset (women only)",
        locationName: "Parc Diagonal Mar",
        lat: 41.4099, lng: 2.2188,
        intent: "social", paceSeconds: 330, distanceKm: 6,
        note: "Women-only golden-hour loop by the sea.",
        bcn: [2026, 5, 31, 19, 0], // Sun 31 May, 19:00
      },
    ],
  },
];

function secondsToInterval(seconds) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `00:${mm}:${ss}`;
}

async function resolveHostId(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data?.users ?? []).find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (match) return match.id;
    if (!data || data.users.length < 200) break;
  }
  return null;
}

function buildRow(host, hostId, r) {
  const startIso = bcnToUtcIso(...r.bcn);
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
    city: "bcn",
    location: `POINT(${r.lng} ${r.lat})`,
    day: start.toLocaleDateString("en-US", { weekday: "short", timeZone: "Europe/Madrid" }).toUpperCase(),
    run_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(start),
    time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Madrid" }).format(start),
    goal: r.intent,
    spots_total: 4,
    spots_taken: 1,
    status: "active",
    recurrence: null,
    women_only: host.womenOnly,
    is_seed: true,
  };
}

async function processHost(host, resetOnly) {
  const hostId = await resolveHostId(host.email);
  if (!hostId) {
    console.error(`! ${host.email}: no auth user (must sign in once). Skipping.`);
    return;
  }
  const { data: profile } = await supabase.from("users").select("id, name").eq("id", hostId).maybeSingle();
  if (!profile) {
    console.error(`! ${host.email}: auth user exists but no profile row (complete onboarding). Skipping.`);
    return;
  }
  console.log(`host: ${host.email} -> ${hostId} (${profile.name ?? "no name"})`);

  // Always clear prior copies of these titles first (idempotent).
  const titles = host.runs.map((r) => r.title);
  const { data: del, error: delErr } = await supabase
    .from("runs")
    .delete()
    .eq("organiser_id", hostId)
    .in("title", titles)
    .select("id");
  if (delErr) throw delErr;
  console.log(`  reset: deleted ${del?.length ?? 0}`);
  if (resetOnly) return;

  const rows = host.runs.map((r) => buildRow(host, hostId, r));
  const { data, error } = await supabase.from("runs").insert(rows).select("id, title, start_time, women_only");
  if (error) throw error;
  console.log(`  inserted ${data.length}${host.womenOnly ? " (women-only)" : ""}`);
  for (const row of data) {
    console.log(`    ${row.start_time}  ${row.title}${row.women_only ? "  [women only]" : ""}`);
  }
}

async function main() {
  const resetOnly = process.argv.includes("--reset");
  for (const host of HOSTS) {
    await processHost(host, resetOnly);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
