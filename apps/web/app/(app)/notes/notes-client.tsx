"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/empty-state";
import { RichTextEditor } from "@/components/rich-text-editor";
import { WriterButton } from "@/components/writer-button";
import { ResearchButton } from "@/components/research-button";
import { createNote } from "./actions";
import { useLocale } from "@/lib/i18n/locale-provider";

type Project = { id: string; name: string };
type NoteItem = {
  id: string;
  title: string;
  content?: string;
  note_type: string;
  updated_at: string;
  projects: { id: string; name: string } | null;
};

const NOTE_TYPES = [
  { id: "all", label: "All Notes" },
  { id: "note", label: "Notes" },
  { id: "meeting", label: "Meetings" },
  { id: "decision", label: "Decisions" },
  { id: "summary", label: "Summaries" },
];

function getSnippet(content?: string) {
  if (!content) return "No content yet...";
  const clean = content
    .replace(/<[^>]*>/g, "")
    .replace(/\\?\[\\?\[([^\]]+?)\\?\]\\?\]/g, "$1")
    .replace(/[#*`_>~]/g, "")
    .trim();
  return clean || "No content yet...";
}

export function NotesClient({
  notes = [],
  projects = [],
  initialQuery = "",
  initialType = "all",
  initialProject = "",
}: {
  notes?: NoteItem[];
  projects?: Project[];
  initialQuery?: string;
  initialType?: string;
  initialProject?: string;
}) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const { t } = useLocale();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [selectedType, setSelectedType] = useState(initialType || "all");
  const [selectedProject, setSelectedProject] = useState(initialProject || "");

  const safeNotes = notes ?? [];
  const safeProjects = projects ?? [];

  // Real-time client-side filtered notes (0ms typing response)
  const filteredNotes = safeNotes.filter((note) => {
    if (!note) return false;
    if (selectedType !== "all" && note.note_type !== selectedType) {
      return false;
    }
    if (selectedProject && note.projects?.id !== selectedProject) {
      return false;
    }
    if (query.trim()) {
      const q = query.toLowerCase().trim();
      const titleMatch = (note.title ?? "").toLowerCase().includes(q);
      const contentMatch = (note.content ?? "").toLowerCase().includes(q);
      if (!titleMatch && !contentMatch) return false;
    }
    return true;
  });

  // Debounced URL sync (250ms after typing stops) to preserve search state
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (selectedType && selectedType !== "all") params.set("type", selectedType);
      if (selectedProject) params.set("project", selectedProject);

      const str = params.toString();
      const newUrl = str ? `/notes?${str}` : "/notes";
      router.replace(newUrl, { scroll: false });
    }, 250);

    return () => clearTimeout(timer);
  }, [query, selectedType, selectedProject, router]);

  function handleFilterChange(newType: string, newProject: string) {
    setSelectedType(newType);
    setSelectedProject(newProject);
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{t("notes")}</h1>
          <p className="text-sm text-muted-foreground">
            Knowledge, meeting records, and decisions organized in your second brain.
          </p>
        </div>

        <div className="flex flex-col flex-wrap gap-2 self-start sm:flex-row sm:items-center sm:self-auto">
          <WriterButton apiUrl={process.env.NEXT_PUBLIC_API_URL!} />
          <ResearchButton apiUrl={process.env.NEXT_PUBLIC_API_URL!} />
          <Button
            onClick={() => setShowCreate((prev) => !prev)}
            className="gap-1.5"
          >
            {showCreate ? (
              <>
                <Icon name="close" size={16} /> Close
              </>
            ) : (
              <>
                <Icon name="add" size={16} /> New Note
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Quick Note Creation Pane */}
      {showCreate && (
        <Card className="border-primary/30 bg-card shadow-md animate-in fade-in zoom-in-95 duration-200">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h2 className="font-heading text-base font-semibold flex items-center gap-2">
                <Icon name="description" size={16} className="text-primary" />
                Create New Note
              </h2>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <form action={createNote} className="space-y-3">
              <Input name="title" placeholder="Note Title" required className="font-medium" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select name="note_type" defaultValue="note" className="w-full">
                  <option value="note">Note</option>
                  <option value="meeting">Meeting</option>
                  <option value="decision">Decision</option>
                  <option value="summary">Summary</option>
                </Select>
                <Select name="project_id" defaultValue="" className="w-full">
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </div>
              <RichTextEditor name="content" />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <SubmitButton pendingText="Saving...">{t("saveNote")}</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Note Type Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-2">
        {NOTE_TYPES.map((t) => {
          const active = selectedType === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handleFilterChange(t.id, selectedProject)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Search & Project Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Icon name="search" size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles and content in real-time..."
            className="pl-9 pr-8 w-full"
          />
          {query.trim() && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <Select
          value={selectedProject}
          onChange={(e) => handleFilterChange(selectedType, e.target.value)}
          className="w-full sm:w-48"
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Notes Grid */}
      <div className="space-y-3">
        {filteredNotes.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredNotes.map((note) => {
              const project = note.projects;
              return (
                <Link key={note.id} href={`/notes/${note.id}`} className="group block">
                  <Card className="h-full transition-all duration-200 hover:border-primary/50 hover:shadow-md">
                    <CardContent className="flex h-full flex-col justify-between p-4 space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="muted" className="capitalize text-[11px]">
                            {note.note_type}
                          </Badge>
                          {project && (
                            <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground truncate max-w-[120px]">
                              <Icon name="folder" size={12} />
                              {project.name}
                            </span>
                          )}
                        </div>
                        <h3 className="font-heading text-base font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                          {note.title}
                        </h3>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {getSnippet(note.content)}
                        </p>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/40 pt-2.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Icon name="calendar_month" size={12} />
                          {new Date(note.updated_at).toLocaleDateString()}
                        </span>
                        <Icon
                          name="chevron_right"
                          size={16}
                          className="text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : query.trim() || selectedType !== "all" || selectedProject ? (
          <EmptyState
            icon="search"
            title="No notes found"
            description={`No notes match your current search "${query}".`}
          />
        ) : (
          <EmptyState
            icon="description"
            title="No notes yet"
            description="Click '+ New Note' above or capture thoughts in the Inbox to get started."
          />
        )}
      </div>
    </div>
  );
}
