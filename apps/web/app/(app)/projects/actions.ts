"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const overview = String(formData.get("overview") ?? "").trim();

  const { error } = await supabase
    .from("projects")
    .insert({ user_id: user.id, name, overview: overview || null });
  if (error) throw new Error(`Couldn't create the project: ${error.message}`);

  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

export async function deleteProject(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw new Error(`Couldn't delete the project: ${error.message}`);

  revalidatePath("/projects");
  revalidatePath("/dashboard");
}
