"use client";

import { Editor } from "@tinymce/tinymce-react";

// Self-hosted (see scripts/copy-tinymce.js + public/tinymce), not Tiny
// Cloud - no API key needed. licenseKey: "gpl" is the required opt-in to
// use the open-source build without one.
//
// textareaName renders a hidden <textarea name={name}> that TinyMCE keeps
// in sync and that native form submission (our Server Actions read via
// FormData) picks up automatically - no controlled-input/React-state
// plumbing needed to fit the existing action={fn} form pattern.
export function RichTextEditor({
  name,
  initialValue,
}: {
  name: string;
  initialValue?: string;
}) {
  return (
    <Editor
      tinymceScriptSrc="/tinymce/tinymce.min.js"
      licenseKey="gpl"
      textareaName={name}
      initialValue={initialValue}
      init={{
        height: 420,
        menubar: false,
        // "blockquote" is a core toolbar formatting command in TinyMCE
        // 6+, not a loadable plugin - listing it here 404s.
        plugins: ["lists", "link", "code", "table"],
        toolbar:
          "undo redo | blocks | bold italic | bullist numlist | blockquote link | code",
        content_style:
          "body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; }",
        branding: false,
        promotion: false,
      }}
    />
  );
}
