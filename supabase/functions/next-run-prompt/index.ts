import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = serviceClient();
  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const { data: matches, error } = await supabase
    .from("matches")
    .select("id, run:runs(id, run_date, time, organiser_id), joiner_id")
    .eq("status", "completed");

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  const due = matches.filter((match) => {
    const runAt = new Date(`${match.run.run_date}T${match.run.time}`);
    return runAt <= fortyEightHoursAgo;
  });

  await supabase.from("notification_jobs").insert(
    due.flatMap((match) => [
      {
        channel: "email",
        template: "ready_for_next_run",
        user_id: match.run.organiser_id,
        run_id: match.run.id,
        match_id: match.id,
        scheduled_for: now.toISOString()
      },
      {
        channel: "email",
        template: "ready_for_next_run",
        user_id: match.joiner_id,
        run_id: match.run.id,
        match_id: match.id,
        scheduled_for: now.toISOString()
      }
    ])
  );

  return Response.json({ queued: due.length }, { headers: corsHeaders });
});
