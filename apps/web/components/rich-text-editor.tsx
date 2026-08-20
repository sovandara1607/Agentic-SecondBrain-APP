"use client";

import { useEffect, useState } from "react";
import { Editor } from "@tinymce/tinymce-react";
import { createClient } from "@/lib/supabase/client";

// TinyMCE has no live skin-swap API - switching skin/content_css only
// takes effect on (re)init, so useIsDark's value is used as the
// Editor's `key` below to force a clean remount on theme change instead
// of a half-applied stale skin.
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    // Legitimate Effect use: reads/observes the DOM (an external
    // system), which doesn't exist during server render and can only
    // be read post-mount.
    const root = document.documentElement;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(root.classList.contains("dark"));
    // theme-toggle.tsx flips the class directly with no accompanying
    // event, so a MutationObserver is the only way to notice.
    const observer = new MutationObserver(() => setIsDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

// [[Wikilink]] autocomplete data - fetched once per mount, not re-fetched
// on every keystroke. A slightly stale title list is an acceptable
// trade-off for an autocomplete suggestion source (worst case: a note
// created seconds ago doesn't show up yet).
function useNoteTitles(): string[] {
  const [titles, setTitles] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("notes")
      .select("title")
      .order("updated_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (!cancelled && data) setTitles(data.map((n) => n.title));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return titles;
}

async function uploadNoteImage(blob: Blob, filename: string): Promise<string> {
  const uploadUrlRes = await fetch("/api/notes/image-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType: blob.type, size: blob.size }),
  });
  const uploadUrlBody = await uploadUrlRes.json();
  if (!uploadUrlRes.ok) {
    throw new Error(uploadUrlBody.detail || `Upload failed (${uploadUrlRes.status})`);
  }

  const { error } = await createClient()
    .storage.from("note-images")
    .uploadToSignedUrl(uploadUrlBody.path, uploadUrlBody.token, blob, { contentType: blob.type });
  if (error) throw new Error(error.message);

  // Stable, authenticated URL (apps/web/app/api/notes/image/[...path]/
  // route.ts) rather than a signed Storage URL baked into the note's
  // markdown - a signed URL would expire and break the image later.
  return `/api/notes/image/${uploadUrlBody.path}`;
}

export function RichTextEditor({
  name,
  value,
  initialValue,
  onChange,
}: {
  name: string;
  value?: string;
  initialValue?: string;
  onChange?: (value: string) => void;
}) {
  const isDark = useIsDark();
  const noteTitles = useNoteTitles();

  return (
    <Editor
      key={isDark ? "dark" : "light"}
      tinymceScriptSrc="/tinymce/tinymce.min.js"
      licenseKey="gpl"
      textareaName={name}
      value={value}
      initialValue={initialValue}
      onEditorChange={(newContent) => {
        if (onChange) {
          onChange(newContent);
        }
      }}
      init={{
        height: 420,
        menubar: false,
        statusbar: true,
        skin: isDark ? "oxide-dark" : "oxide",
        content_css: isDark ? "dark" : "default",
        plugins: ["lists", "link", "code", "table", "wordcount", "fullscreen", "codesample"],
        toolbar:
          "undo redo | blocks | bold italic | bullist numlist | blockquote link | codesample code | fullscreen",
        content_style:
          "body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; }",
        branding: false,
        promotion: false,

        // Image paste/upload: paste_data_images lets a pasted image
        // become an upload candidate at all; images_upload_handler is
        // what TinyMCE calls (for paste, drag-drop, and the image
        // dialog alike) once it has a candidate to upload.
        paste_data_images: true,
        images_upload_handler: async (blobInfo) => {
          const blob = blobInfo.blob();
          const filename = blobInfo.filename() || `image-${Date.now()}.png`;
          return uploadNoteImage(blob, filename);
        },

        setup: (editor) => {
          // [[Wikilink]] autocomplete - matches this app's own note-
          // linking convention (apps/web/app/(app)/notes/actions.ts's
          // WIKILINK_PATTERN), so the syntax is discoverable instead of
          // requiring the exact title to be typed blind.
          editor.ui.registry.addAutocompleter("wikilink", {
            trigger: "[[",
            minChars: 0,
            columns: 1,
            fetch: (pattern) => {
              const needle = pattern.toLowerCase();
              const matches = noteTitles
                .filter((title) => title.toLowerCase().includes(needle))
                .slice(0, 10)
                .map((title) => ({ type: "autocompleteitem" as const, value: title, text: title }));
              return Promise.resolve(matches);
            },
            onAction: (autocompleteApi, range, value) => {
              editor.selection.setRng(range);
              editor.insertContent(`[[${value}]]`);
              autocompleteApi.hide();
            },
          });
        },
      }}
    />
  );
}
