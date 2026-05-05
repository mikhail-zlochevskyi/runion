import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { match_id } = await request.json();
  const supabase = serviceClient();

  const { data: match, error } = await supabase
    .from("matches")
    .select("id, status, run:runs(*, organiser:users(*)), joiner:users(*)")
    .eq("id", match_id)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });

  await supabase.from("notification_jobs").insert([
    {
      channel: "whatsapp",
      template: "match_created_plan",
      user_id: match.run.organiser_id,
      run_id: match.run.id,
      match_id: match.id,
      scheduled_for: new Date().toISOString()
    },
    {
      channel: "whatsapp",
      template: "match_created_plan",
      user_id: match.joiner.id,
      run_id: match.run.id,
      match_id: match.id,
      scheduled_for: new Date().toISOString()
    }
  ]);

  return Response.json({ queued: true }, { headers: corsHeaders });
});
