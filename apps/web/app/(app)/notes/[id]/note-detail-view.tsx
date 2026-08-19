"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteButton } from "@/components/delete-button";
import { RichTextEditor } from "@/components/rich-text-editor";
import { friendlyError } from "@/lib/friendly-error";
import {
  deleteNote,
  addNoteTag,
  removeNoteTag,
  saveNoteContent,
} from "../actions";

type Note = {
  id: string;
  title: string;
  content: string;
  note_type: string;
  project_id: string | null;
  ai_summary: string | null;
  capture_id: string | null;
  created_at: string;
  updated_at: string;
};

type Project = { id: string; name: string };
type TagItem = { id: string; name: string };
type LinkedNote = { id: string; title: string };

type SaveStatus = "saved" | "saving" | "unsaved" | "error";

export function NoteDetailView({
  note,
  html = "",
  tags = [],
  projects = [],
  linkedNotes = [],
  backlinkNotes = [],
}: {
  note: Note;
  html?: string;
  tags?: TagItem[];
  projects?: Project[];
  linkedNotes?: LinkedNote[];
  backlinkNotes?: LinkedNote[];
}) {
  const [isEditing, setIsEditing] = useState(false);

  // Auto-save form fields
  const [title, setTitle] = useState(note?.title ?? "");
  const [noteType, setNoteType] = useState(note?.note_type ?? "note");
  const [projectId, setProjectId] = useState(note?.project_id ?? "");
  const [htmlContent, setHtmlContent] = useState(html ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentProject = (projects ?? []).find((p) => p.id === projectId);
  const isFirstRender = useRef(true);

  // Debounced Auto-Save effect
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setSaveStatus("unsaved");
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      setErrorMessage(null);

      try {
        const res = await saveNoteContent({
          id: note.id,
          title,
          html: htmlContent,
          note_type: noteType,
          project_id: projectId || null,
        });

        if (res?.success) {
          setSaveStatus("saved");
        } else {
          console.error("note save failed:", res?.error);
          setSaveStatus("error");
          setErrorMessage(res?.error ? friendlyError(res.error) : "Couldn't save. Please try again.");
        }
      } catch (err) {
        console.error("note save failed:", err);
        setSaveStatus("error");
        setErrorMessage(friendlyError(err));
      }
    }, 750);

    return () => clearTimeout(timer);
  }, [title, noteType, projectId, htmlContent, note.id]);

  if (!note) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Top Navigation Bar & Auto-Save Indicator */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/notes"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="arrow_back" size={14} weight={600} />
          Back to Notes
        </Link>

        <div className="flex items-center gap-3">
          {/* Live Auto-Save Status Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/50 bg-muted/30 text-xs">
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <Icon name="check" size={14} /> Saved
              </span>
            )}
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1.5 text-primary font-medium">
                <Icon name="progress_activity" size={14} className="animate-spin" /> Saving...
              </span>
            )}
            {saveStatus === "unsaved" && (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                <span className="size-2 rounded-full bg-amber-500 animate-pulse" /> Auto-saving...
              </span>
            )}
            {saveStatus === "error" && (
              <span className="flex items-center gap-1.5 text-destructive font-medium" title={errorMessage ?? undefined}>
                <Icon name="error" size={14} /> Save failed
              </span>
            )}
          </div>

          <Button
            type="button"
            variant={isEditing ? "default" : "outline"}
            size="sm"
            onClick={() => setIsEditing((prev) => !prev)}
            className="gap-1.5 text-xs"
          >
            {isEditing ? (
              <>
                <Icon name="menu_book" size={14} />
                Reading Mode
              </>
            ) : (
              <>
                <Icon name="edit" size={14} />
                Edit Note
              </>
            )}
          </Button>

          <DeleteButton
            action={deleteNote}
            id={note.id}
            confirmMessage={`Delete "${title}"? This can't be undone.`}
            label="Delete"
            variant="button"
          />
        </div>
      </div>

      {/* Header Info Banner */}
      <div className="space-y-3 rounded-xl border border-border/60 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted" className="capitalize">
            {noteType}
          </Badge>
          {currentProject && (
            <Badge variant="muted" className="gap-1">
              <Icon name="folder" size={12} className="text-muted-foreground" />
              {currentProject.name}
            </Badge>
          )}
          {note.capture_id && (
            <Badge variant="muted" className="gap-1 text-primary">
              <Icon name="auto_awesome" size={12} />
              From Capture
            </Badge>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
            <Icon name="calendar_month" size={12} />
            Updated {note.updated_at ? new Date(note.updated_at).toLocaleDateString() : "Just now"}
          </span>
        </div>

        {!isEditing ? (
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="title" className="text-xs text-muted-foreground">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title..."
              className="font-heading text-xl font-bold border-none px-0 shadow-none focus-visible:ring-0"
            />
          </div>
        )}

        {/* Tags Bar */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40">
          <Icon name="sell" size={14} className="text-muted-foreground shrink-0" />
          {(tags ?? []).map((tag) => (
            <form key={tag.id} action={removeNoteTag} className="inline-flex">
              <input type="hidden" name="note_id" value={note.id} />
              <input type="hidden" name="tag_id" value={tag.id} />
              <Badge variant="muted" className="gap-1 pr-1 text-xs">
                {tag.name}
                <FormSubmitButton
                  aria-label={`Remove tag ${tag.name}`}
                  className="rounded-full hover:text-destructive transition-colors"
                >
                  <Icon name="close" size={12} weight={600} />
                </FormSubmitButton>
              </Badge>
            </form>
          ))}

          <form action={addNoteTag} className="inline-flex items-center gap-1">
            <input type="hidden" name="note_id" value={note.id} />
            <Input
              name="tag_name"
              placeholder="+ Add tag"
              className="h-6 w-24 px-2 text-xs border-dashed"
            />
            <SubmitButton size="xs" variant="ghost" className="h-6 text-xs" pendingText="...">
              Add
            </SubmitButton>
          </form>
        </div>
      </div>

      {/* AI Summary Banner */}
      {note.ai_summary && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-start gap-3 p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon name="auto_awesome" size={16} weight={600} />
            </span>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider">
                AI Summary
              </p>
              <p className="text-sm text-foreground/90 leading-relaxed">
                {note.ai_summary}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Canvas: Reading Mode vs Editing Mode */}
      {!isEditing ? (
        <Card className="shadow-xs">
          <CardContent className="p-6">
            {htmlContent ? (
              <div
                className="prose dark:prose-invert max-w-none text-foreground/90 leading-relaxed [&>h1]:font-heading [&>h2]:font-heading [&>h3]:font-heading"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            ) : (
              <p className="text-sm italic text-muted-foreground">
                This note has no content yet. Click &quot;Edit Note&quot; above to add markdown.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-xs">
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="note_type">Type</Label>
                <Select
                  id="note_type"
                  value={noteType}
                  onChange={(e) => setNoteType(e.target.value)}
                  className="w-full"
                >
                  <option value="note">Note</option>
                  <option value="meeting">Meeting</option>
                  <option value="decision">Decision</option>
                  <option value="summary">Summary</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project_id">Project</Label>
                <Select
                  id="project_id"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full"
                >
                  <option value="">No project</option>
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Content (Auto-saves while typing)</Label>
              <RichTextEditor
                name="content"
                value={htmlContent}
                onChange={(newVal) => setHtmlContent(newVal)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connected Knowledge Section (Backlinks & Links) */}
      {((linkedNotes?.length ?? 0) > 0 || (backlinkNotes?.length ?? 0) > 0) && (
        <div className="space-y-3 rounded-xl border border-border/60 bg-card p-5">
          <h3 className="font-heading text-sm font-semibold flex items-center gap-2">
            <Icon name="link" size={16} className="text-primary" />
            Connected Second Brain Notes
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {(linkedNotes?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Linked Notes
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {linkedNotes.map((n) => (
                    <Link key={n.id} href={`/notes/${n.id}`}>
                      <Badge variant="muted" className="gap-1.5 hover:bg-muted/80">
                        <Icon name="link" size={12} className="text-primary" weight={600} />
                        {n.title}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {(backlinkNotes?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Mentioned In (Backlinks)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {backlinkNotes.map((n) => (
                    <Link key={n.id} href={`/notes/${n.id}`}>
                      <Badge variant="muted" className="gap-1.5 hover:bg-muted/80">
                        <Icon name="link" size={12} className="text-primary" weight={600} />
                        {n.title}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
