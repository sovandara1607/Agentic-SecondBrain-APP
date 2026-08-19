import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { DeleteButton } from "@/components/delete-button";
import { ReprocessButton } from "@/components/reprocess-button";
import { SubmitButton } from "@/components/submit-button";
import { Icon } from "@/components/ui/icon";
import { MediaCaptureForm } from "./media-capture-form";
import { createCapture, deleteCapture } from "./actions";
import { Trans } from "@/components/trans";

const KIND_ICON: Record<string, string> = {
  text: "notes",
  url: "link",
  voice: "mic",
  image: "image",
  pdf: "picture_as_pdf",
};

const KIND_PLACEHOLDER: Record<string, string> = {
  voice: "Voice memo",
  image: "Image",
  pdf: "PDF document",
};

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
    .select(
      "id, kind, raw_text, source_url, status, pipeline_error, created_at, notes(id, title)",
    )
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold"><Trans id="inbox" /></h1>
        <p className="text-sm text-muted-foreground">
          Drop in text, a link, a voice memo, or an image/PDF. The processing pipeline organizes
          it later.
        </p>
      </div>

      <form action={createCapture} className="space-y-3">
        <Textarea name="raw_text" placeholder="Jot something down..." rows={3} />
        <Input name="source_url" type="url" placeholder="Or paste a URL (optional)" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SubmitButton pendingText="Capturing...">Capture</SubmitButton>
          <MediaCaptureForm />
        </div>
      </form>

      <div className="space-y-2">
        {captures?.length ? (
          captures.map((capture) => {
            const note = capture.notes?.[0];
            return (
              <Card key={capture.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <Icon
                        name={KIND_ICON[capture.kind] ?? "notes"}
                        size={14}
                        className="shrink-0 text-muted-foreground"
                      />
                      {capture.raw_text ||
                        capture.source_url ||
                        KIND_PLACEHOLDER[capture.kind] ||
                        "Capture"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {capture.kind} &middot;{" "}
                      {new Date(capture.created_at).toLocaleString()}
                    </p>
                    {note && (
                      <Link
                        href={`/notes/${note.id}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        View note: {note.title}
                      </Link>
                    )}
                    {capture.status === "failed" && capture.pipeline_error && (
                      <p className="text-xs text-destructive">
                        {capture.pipeline_error}
                      </p>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-0 border-border/40">
                    <Badge variant={STATUS_VARIANT[capture.status] ?? "muted"}>
                      {capture.status}
                    </Badge>
                    {(capture.status === "failed" || capture.status === "needs_review") && (
                      <ReprocessButton
                        apiUrl={process.env.NEXT_PUBLIC_API_URL!}
                        captureId={capture.id}
                      />
                    )}
                    <DeleteButton
                      action={deleteCapture}
                      id={capture.id}
                      confirmMessage="Delete this capture?"
                      label="Delete capture"
                    />
                  </span>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <EmptyState
            icon="inbox"
            title="Nothing captured yet"
            description="Drop in a thought or paste a link above - it lands here first."
          />
        )}
      </div>
    </div>
  );
}
