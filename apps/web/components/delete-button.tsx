"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      {variant === "icon" ? (
        <button
          type="submit"
          aria-label={label}
          title={label}
          className="text-muted-foreground transition-colors hover:text-destructive"
        >
          <Trash2 className="size-4" strokeWidth={1.75} />
        </button>
      ) : (
        <Button type="submit" variant="destructive">
          <Trash2 className="size-4" strokeWidth={1.75} />
          {label}
        </Button>
      )}
    </form>
  );
}
