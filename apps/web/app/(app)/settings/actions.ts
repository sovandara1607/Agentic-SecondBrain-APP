"use server";

import { randomBytes, createHash } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Must match apps/api/core/auth.py's API_TOKEN_PREFIX exactly - that's
// how verify_jwt_or_api_token tells a personal access token apart from
// a Supabase session JWT without trying (and always failing) the wrong
// verifier first.
const API_TOKEN_PREFIX = "sb_pat_";

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fullName = String(formData.get("full_name") ?? "").trim();

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName || null })
    .eq("id", user.id);
  if (error) throw new Error(`Couldn't save your profile: ${error.message}`);

  revalidatePath("/settings");
}

const ENERGY_LEVELS = new Set(["low", "medium", "high"]);

function clampWeight(raw: FormDataEntryValue | null, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

export async function updateSchedulingPreferences(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const startTime = String(formData.get("start_time") ?? "09:00");
  const endTime = String(formData.get("end_time") ?? "18:00");
  const days = formData
    .getAll("days")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b);

  const energyProfile: Record<string, string> = {};
  for (const period of ["morning", "afternoon", "evening"]) {
    const value = String(formData.get(`energy_${period}`) ?? "medium");
    energyProfile[period] = ENERGY_LEVELS.has(value) ? value : "medium";
  }

  const schedulerWeights = {
    urgency: clampWeight(formData.get("weight_urgency"), 0.5),
    priority: clampWeight(formData.get("weight_priority"), 0.3),
    project_weight: clampWeight(formData.get("weight_project"), 0.2),
  };

  const { error } = await supabase
    .from("profiles")
    .update({
      working_hours: {
        start: startTime,
        end: endTime,
        // Empty selection would leave the scheduler with no work days at
        // all (every candidate silently unplaceable) - fall back to the
        // schema default rather than saving a self-defeating empty week.
        days: days.length ? days : [1, 2, 3, 4, 5],
      },
      energy_profile: energyProfile,
      scheduler_weights: schedulerWeights,
    })
    .eq("id", user.id);
  if (error) throw new Error(`Couldn't save your scheduling preferences: ${error.message}`);

  revalidatePath("/settings");
}

export type CreateApiTokenState = { token: string | null; error: string | null };

// V2 roadmap (Section 17): "Public API: for users who want to script
// their own capture sources." The plaintext token exists only in this
// function's return value and the browser's memory afterward - the
// database only ever receives its SHA-256 hash (apps/api/core/auth.py's
// _verify_api_token does the same hash to look it up), so there is no
// way to recover it later, by design; a lost token means generating a
// new one.
export async function createApiToken(
  _prevState: CreateApiTokenState,
  formData: FormData,
): Promise<CreateApiTokenState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim() || "Unnamed token";
  const token = API_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { error } = await supabase.from("api_tokens").insert({
    user_id: user.id,
    name,
    token_hash: tokenHash,
    token_prefix: token.slice(0, API_TOKEN_PREFIX.length + 6),
  });
  if (error) return { token: null, error: `Couldn't create the token: ${error.message}` };

  revalidatePath("/settings");
  return { token, error: null };
}

export async function revokeApiToken(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // RLS (0008_api_tokens.sql's "update own rows" policy) already blocks
  // cross-user revocation at the database layer, but scoping by user_id
  // here too avoids a silent, confusing no-op if a stale/tampered id is
  // submitted - the caller gets 0 rows affected either way, this just
  // makes the intent explicit rather than relying on RLS alone.
  const { error } = await supabase
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(`Couldn't revoke the token: ${error.message}`);

  revalidatePath("/settings");
}
