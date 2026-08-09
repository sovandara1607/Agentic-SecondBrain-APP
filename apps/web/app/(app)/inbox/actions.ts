"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createCapture(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const rawText = String(formData.get("raw_text") ?? "").trim();
  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  if (!rawText && !sourceUrl) return;

  await supabase.from("captures").insert({
    user_id: user.id,
    kind: sourceUrl ? "url" : "text",
    raw_text: rawText || null,
    source_url: sourceUrl || null,
  });

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}
