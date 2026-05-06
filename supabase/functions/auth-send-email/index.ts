import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type HookUser = {
  email: string;
  new_email?: string;
};

type HookEmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new: string;
  token_hash_new: string;
};

function hookSecret(): string {
  const raw = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  if (!raw) throw new Error("Missing SEND_EMAIL_HOOK_SECRET");
  return raw.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
}

function verifyLink(email_data: HookEmailData, tokenHash: string): string {
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
  if (!base) throw new Error("Missing SUPABASE_URL");
  const q = new URLSearchParams({
    token: tokenHash,
    type: email_data.email_action_type,
    redirect_to: email_data.redirect_to
  });
  return `${base}/auth/v1/verify?${q}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function subjectFor(action: string): string {
  switch (action) {
    case "signup":
      return "Confirm your Runion email";
    case "magiclink":
      return "Your Runion sign-in link";
    case "recovery":
      return "Reset your Runion password";
    case "invite":
      return "You're invited to Runion";
    case "email_change":
      return "Confirm your Runion email change";
    case "reauthentication":
      return "Your Runion verification code";
    case "email":
      return "Runion notification";
    default:
      return "Runion account notification";
  }
}

async function sendWithResend(to: string, subject: string, html: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM");
  if (!key || !from) throw new Error("Missing RESEND_API_KEY or RESEND_FROM");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

function htmlConfirm(title: string, href: string, code: string): string {
  const safe = escHtml(href);
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${escHtml(title)}</p>
<p><a href="${safe}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Continue</a></p>
<p style="word-break:break-all;font-size:13px;color:#444">If the button does not work, open:<br/>${href}</p>
<p>Or enter this code: <strong>${escHtml(code)}</strong></p>
</body></html>`;
}

function textConfirm(title: string, href: string, code: string): string {
  return `${title}\n\n${href}\n\nOr enter this code: ${code}`;
}

const ACTIONS_WITH_VERIFY_LINK = new Set([
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "reauthentication",
  "email"
]);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const wh = new Webhook(hookSecret());

  let user: HookUser;
  let email_data: HookEmailData;

  try {
    ({ user, email_data } = wh.verify(payload, headers) as { user: HookUser; email_data: HookEmailData });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: { message } }, { status: 401 });
  }

  const action = email_data.email_action_type;

  try {
    // Secure email change: two messages (current vs new address); token/hash pairing per Supabase docs.
    if (
      action === "email_change" &&
      typeof user.new_email === "string" &&
      user.new_email.length > 0 &&
      email_data.token_hash_new &&
      email_data.token_new
    ) {
      const hrefOld = verifyLink(email_data, email_data.token_hash_new);
      const hrefNew = verifyLink(email_data, email_data.token_hash);
      await sendWithResend(
        user.email,
        "Confirm email change on Runion",
        htmlConfirm("Confirm the email change from this inbox.", hrefOld, email_data.token),
        textConfirm("Confirm the email change from this inbox.", hrefOld, email_data.token)
      );
      await sendWithResend(
        user.new_email,
        "Confirm your new Runion email",
        htmlConfirm("Confirm your new email address for Runion.", hrefNew, email_data.token_new),
        textConfirm("Confirm your new email address for Runion.", hrefNew, email_data.token_new)
      );
    } else if (ACTIONS_WITH_VERIFY_LINK.has(action) && email_data.token_hash) {
      const href = verifyLink(email_data, email_data.token_hash);
      const title =
        action === "magiclink"
          ? "Use this link to sign in to Runion."
          : action === "recovery"
            ? "Use this link to reset your Runion password."
            : action === "invite"
              ? `You've been invited. Continue on ${email_data.site_url || "Runion"}.`
              : "Continue with Runion.";
      await sendWithResend(user.email, subjectFor(action), htmlConfirm(title, href, email_data.token), textConfirm(title, href, email_data.token));
    } else if (action === "email_change" && email_data.token_hash) {
      const href = verifyLink(email_data, email_data.token_hash);
      const to = user.new_email?.trim().length ? user.new_email : user.email;
      await sendWithResend(
        to,
        subjectFor(action),
        htmlConfirm("Confirm your email address change for Runion.", href, email_data.token),
        textConfirm("Confirm your email address change for Runion.", href, email_data.token)
      );
    } else {
      await sendWithResend(
        user.email,
        subjectFor(action),
        `<p>${subjectFor(action)}</p><p>If you did not request this, you can ignore this message.</p>`,
        `${subjectFor(action)}\n\nIf you did not request this, you can ignore this message.`
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: { message } }, { status: 500 });
  }

  return Response.json({});
});
