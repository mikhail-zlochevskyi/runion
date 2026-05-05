import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = serviceClient();
  const now = new Date().toISOString();

  const { data: expired, error } = await supabase
    .from("runs")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("expires_at", now)
    .select("id, organiser_id");

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  if (expired.length) {
    await supabase.from("notification_jobs").insert(
      expired.map((run) => ({
        channel: "email",
        template: "run_expired_no_match",
        user_id: run.organiser_id,
        run_id: run.id,
        scheduled_for: now
      }))
    );
  }

  return Response.json({ expired: expired.length }, { headers: corsHeaders });
});
