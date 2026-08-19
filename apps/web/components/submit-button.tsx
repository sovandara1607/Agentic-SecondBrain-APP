"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * The shared <Button>, but pending-aware for a plain `<form
 * action={serverAction}>` - same useFormStatus/separate-component
 * requirement as delete-button.tsx and form-submit-button.tsx (a
 * component can only read the pending state of an ancestor <form>, not
 * one it renders itself). Use this over FormSubmitButton when the
 * call site wants the actual styled Button look, not a bare <button>.
 */
export function SubmitButton({
  children,
  pendingText,
  icon,
  ...props
}: React.ComponentProps<typeof Button> & { pendingText?: string; icon?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} {...props}>
      {(pending || icon) && (
        <Icon name={pending ? "progress_activity" : icon!} size={16} className={pending ? "animate-spin" : undefined} />
      )}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
