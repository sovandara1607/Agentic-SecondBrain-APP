"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// useFormStatus reads the nearest *ancestor* <form>'s pending state - it
// only works from a component rendered inside that form, not the one
// that renders the <form> itself, hence the split from DeleteButton
// below. Previously this had no pending state at all: clicking delete
// gave no feedback until the whole page re-rendered after the server
// action finished, which for anything slower than instant read as "did
// that even do anything?"
function DeleteButtonContent({
  label,
  variant,
}: {
  label: string;
  variant: "icon" | "button";
}) {
  const { pending } = useFormStatus();

  if (variant === "icon") {
    return (
      <button
        type="submit"
        aria-label={label}
        title={label}
        disabled={pending}
        className="text-muted-foreground transition-colors hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon name={pending ? "progress_activity" : "delete"} size={16} className={pending ? "animate-spin" : undefined} />
      </button>
    );
  }

  return (
    <Button type="submit" variant="destructive" disabled={pending} className="gap-1.5">
      <Icon name={pending ? "progress_activity" : "delete"} size={16} className={pending ? "animate-spin" : undefined} />
      {pending ? "Deleting..." : label}
    </Button>
  );
}

export function DeleteButton({
  action,
  id,
  confirmMessage,
  label = "Delete",
  variant = "icon",
}: {
  action: (formData: FormData) => void;
  id: string;
  confirmMessage: string;
  label?: string;
  variant?: "icon" | "button";
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <DeleteButtonContent label={label} variant={variant} />
    </form>
  );
}
