import { createClient } from "@/lib/supabase/server";
import { WorkspaceChat } from "./workspace-chat";
import { Trans } from "@/components/trans";

export default async function WorkspacePage() {
  const supabase = await createClient();
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(30);

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4">
        <h1 className="font-heading text-2xl font-semibold"><Trans id="workspace" /></h1>
        <p className="text-sm text-muted-foreground">
          Ask the Memory agent about anything in your notes, tasks, and
          projects. Answers are grounded in your own account only.
        </p>
      </div>
      <WorkspaceChat
        apiUrl={process.env.NEXT_PUBLIC_API_URL!}
        initialConversations={conversations ?? []}
      />
    </div>
  );
}
