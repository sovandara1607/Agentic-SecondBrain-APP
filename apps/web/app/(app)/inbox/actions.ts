"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createCapture(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawText = String(formData.get("raw_text") ?? "").trim();
  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  if (!rawText && !sourceUrl) return;

  const { error } = await supabase.from("captures").insert({
    user_id: user.id,
    kind: sourceUrl ? "url" : "text",
    raw_text: rawText || null,
    source_url: sourceUrl || null,
  });
  if (error) throw new Error(`Couldn't save the capture: ${error.message}`);

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
}
