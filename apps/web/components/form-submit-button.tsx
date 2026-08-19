"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * A plain `<button type="submit">` styled via `className` that shows a
 * spinner and disables itself while its parent <form>'s server action
 * is in flight (useFormStatus only sees the nearest ancestor <form>,
 * so this has to be a separate component from whatever renders that
 * form - same reason delete-button.tsx splits the same way).
 *
 * For raw `<form action={serverAction}><button>...</button></form>`
 * call sites that want DeleteButton's pending treatment without
 * DeleteButton's confirm-dialog/delete-icon assumptions.
 */
export function FormSubmitButton({
  children,
  pendingText,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingText?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn("disabled:pointer-events-none disabled:opacity-60", className)}
      {...props}
    >
      {pending ? (
        <span className="flex items-center gap-1.5">
          <Icon name="progress_activity" size={13} className="animate-spin" />
          {pendingText ?? children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
