#!/usr/bin/env node
/**
 * One-off seed: a single weekly-recurring Singapore run hosted by
 * mikk171990@gmail.com, starting from 8 Enggor St (Realm @ Tanjong Pagar).
 *
 * Usage:
 *   node scripts/seed-mikk-sg-run.cjs            # insert (idempotent)
 *   node scripts/seed-mikk-sg-run.cjs --reset    # delete it again (by title+host)
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Flagged is_seed=true so it bypasses the open-runs cap and is cleanly removable.
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

const HOST_EMAIL = "mikk171990@gmail.com";

// SGT = UTC+8. Provide SGT wall-clock; we convert to a UTC instant.
function sgtToUtcIso(y, m, d, hh, mm) {
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0, 0)).toISOString();
}

const RUN = {
  title: "MBS loop from Tanjong Pagar",
  locationName: "8 Enggor St (Realm @ Tanjong Pagar)",
  lat: 1.2746,
  lng: 103.8417,
  intent: "social",
  paceSeconds: 330,
  distanceKm: 7,
  note: "MBS loop, coffee.",
  sgt: [2026, 6, 13, 7, 0], // Sat 13 Jun 2026, 07:00 SGT
  recurrence: "weekly",
};

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
  const { data, error } = await supabase
    .from("runs")
    .delete()
    .eq("organiser_id", hostId)
    .eq("title", RUN.title)
    .select("id");
  if (error) throw error;
  console.log(`reset: deleted ${data?.length ?? 0} runs.`);
}

async function populate(hostId) {
  const startIso = sgtToUtcIso(...RUN.sgt);
  const start = new Date(startIso);
  const paceMinSec = Math.max(180, RUN.paceSeconds - 10);
  const paceMaxSec = Math.min(480, RUN.paceSeconds + 10);
  const row = {
    title: RUN.title,
    description: RUN.note ?? null,
    pace_min: secondsToInterval(paceMinSec),
    pace_max: secondsToInterval(paceMaxSec),
    pace_seconds: RUN.paceSeconds,
    distance_km: RUN.distanceKm,
    start_time: startIso,
    location_name: RUN.locationName,
    intent: RUN.intent,
    created_by: hostId,
    organiser_id: hostId,
    max_group_size: 4,
    current_spots: 1,
    city: "sg",
    location: `POINT(${RUN.lng} ${RUN.lat})`,
    day: start.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Singapore" }).toUpperCase(),
    run_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(start),
    time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).format(start),
    goal: RUN.intent,
    spots_total: 4,
    spots_taken: 1,
    status: "active",
    recurrence: RUN.recurrence,
    is_seed: true,
  };

  const { data, error } = await supabase.from("runs").insert(row).select("id, title, start_time, recurrence");
  if (error) throw error;
  const r = data[0];
  console.log(`populate: inserted run for ${HOST_EMAIL}`);
  console.log(`  ${r.start_time}  ${r.title}${r.recurrence ? "  [weekly]" : ""}`);
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
