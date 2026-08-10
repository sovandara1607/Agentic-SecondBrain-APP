"use client";

import { Editor } from "@tinymce/tinymce-react";

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
  return (
    <Editor
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
