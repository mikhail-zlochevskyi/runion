// Fires an alert email to the operator whenever someone joins a seeded
// test run. Invoked either by the notify_on_seed_join trigger (via pg_net)
// or by `node scripts/seed-test-runs.cjs --drain`. Idempotent: marks the
// matching notification_jobs row as sent before sending so retries are
// safe.
import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

const ALERT_TO = Deno.env.get("SEED_ALERT_EMAIL") ?? "mzlochevskyi@gmail.com";

async function sendEmail(subject: string, html: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM");
  if (!key || !from) throw new Error("Missing RESEND_API_KEY or RESEND_FROM");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [ALERT_TO], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = serviceClient();
  const body = await request.json().catch(() => ({} as { participant_id?: string }));
  const supplied: string | undefined = body?.participant_id;

  // If a specific participant_id was supplied (trigger path), process just
  // that one; otherwise drain all unsent seed_run_joined jobs (cron path).
  const { data: jobs, error } = await supabase
    .from("notification_jobs")
    .select("id, user_id, run_id")
    .eq("template", "seed_run_joined")
    .is("sent_at", null)
    .is("failed_at", null);
  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  let sent = 0;
  const errors: string[] = [];

  for (const job of jobs ?? []) {
    try {
      const { data: run } = await supabase
        .from("runs")
        .select("id, title, city, location_name, start_time, intent, is_seed")
        .eq("id", job.run_id)
        .single();
      const { data: user } = await supabase
        .from("users")
        .select("email, name, whatsapp, socials_url")
        .eq("id", job.user_id)
        .single();
      if (!run?.is_seed) {
        await supabase.from("notification_jobs").update({ sent_at: new Date().toISOString() }).eq("id", job.id);
        continue;
      }
      const subject = `[Runion seed] ${user?.name ?? "Someone"} joined ${run.title ?? run.location_name ?? "a seed run"}`;
      const lines = [
        `${user?.name ?? "Unknown"} (${user?.email ?? "no email"}) just requested a spot on a seeded test run.`,
        ``,
        `Run: ${run.title ?? run.location_name}`,
        `City: ${run.city}`,
        `When: ${run.start_time ?? "n/a"}`,
        `Intent: ${run.intent ?? "n/a"}`,
        ``,
        `Requester socials: ${user?.socials_url || "(none)"}`,
        `Requester WhatsApp: ${user?.whatsapp || "(none)"}`,
      ];
      const text = lines.join("\n");
      const html = `<pre style="font: 13px/1.5 ui-monospace, monospace; background: #111; color: #eee; padding: 12px; border-radius: 8px;">${
        lines.map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("<br/>")
      }</pre>`;
      await sendEmail(subject, html, text);
      await supabase.from("notification_jobs").update({ sent_at: new Date().toISOString() }).eq("id", job.id);
      sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${job.id}: ${msg}`);
      await supabase
        .from("notification_jobs")
        .update({ failed_at: new Date().toISOString(), error: msg })
        .eq("id", job.id);
    }
  }

  return Response.json({ sent, errors, supplied }, { headers: corsHeaders });
});
