"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Closes the loop the Workflow agent's own design left open (Section
// 6's hard rule: agents "write only what's unambiguous ... or
// explicitly confirmed by the user") - agent_actions.status already had
// 'confirmed'/'rejected' in its enum from day one, nothing before this
// wrote either. "Confirmed" here means "I've seen this, it's handled" -
// there's no generic executor that interprets a proposal's free-text
// proposed_action and acts on it; the user still does whatever the
// suggestion was about themselves.
async function setWorkflowProposalStatus(formData: FormData, status: "confirmed" | "rejected") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await supabase
    .from("agent_actions")
    .update({ status })
    .eq("id", id)
    .eq("agent_name", "workflow") // scope the status transition to what this action is actually for
    // Redundant with RLS (0010_agent_actions_status_update.sql: "update
    // own status" already scopes rows to auth.uid() = user_id) - kept
    // anyway as defense-in-depth, matching every other ownership check
    // in this codebase (e.g. captures reprocess, note tag mutations).
    .eq("user_id", user.id);
  if (error) throw new Error(`Couldn't update that suggestion: ${error.message}`);

  revalidatePath("/dashboard");
}

export async function confirmWorkflowProposal(formData: FormData) {
  await setWorkflowProposalStatus(formData, "confirmed");
}

export async function dismissWorkflowProposal(formData: FormData) {
  await setWorkflowProposalStatus(formData, "rejected");
}
