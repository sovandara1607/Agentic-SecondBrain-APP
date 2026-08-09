"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const overview = String(formData.get("overview") ?? "").trim();

  await supabase
    .from("projects")
    .insert({ user_id: user.id, name, overview: overview || null });

  revalidatePath("/projects");
  revalidatePath("/dashboard");
}
