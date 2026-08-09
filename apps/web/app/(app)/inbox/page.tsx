import { Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { DeleteButton } from "@/components/delete-button";
import { createCapture, deleteCapture } from "./actions";

const STATUS_VARIANT: Record<
  string,
  "muted" | "warning" | "success" | "destructive"
> = {
  pending: "muted",
  processing: "warning",
  organized: "success",
  needs_review: "warning",
  failed: "destructive",
};

export default async function InboxPage() {
  const supabase = await createClient();
  const { data: captures } = await supabase
    .from("captures")
    .select("id, kind, raw_text, source_url, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Drop in text or a link. The processing pipeline organizes it later.
        </p>
      </div>

      <form action={createCapture} className="space-y-3">
        <Textarea name="raw_text" placeholder="Jot something down..." rows={3} />
        <Input name="source_url" type="url" placeholder="Or paste a URL (optional)" />
        <Button type="submit">Capture</Button>
      </form>

      <div className="space-y-2">
        {captures?.length ? (
          captures.map((capture) => (
            <Card key={capture.id}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {capture.raw_text || capture.source_url}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {capture.kind} &middot;{" "}
                    {new Date(capture.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-3">
                  <Badge variant={STATUS_VARIANT[capture.status] ?? "muted"}>
                    {capture.status}
                  </Badge>
                  <DeleteButton
                    action={deleteCapture}
                    id={capture.id}
                    confirmMessage="Delete this capture?"
                    label="Delete capture"
                  />
                </span>
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState
            icon={Inbox}
            title="Nothing captured yet"
            description="Drop in a thought or paste a link above - it lands here first."
          />
        )}
      </div>
    </div>
  );
}
