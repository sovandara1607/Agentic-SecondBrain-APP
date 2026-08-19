"use client";

import { createContext, use, useCallback, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type ToastVariant = "error" | "success" | "info";
type Toast = { id: number; message: string; variant: ToastVariant };

const AUTO_DISMISS_MS = 6000;

const ToastContext = createContext<((message: string, variant?: ToastVariant) => void) | null>(null);

const VARIANT_META: Record<ToastVariant, { icon: string; classes: string }> = {
  error: { icon: "error", classes: "border-destructive/40 bg-destructive/10 text-destructive" },
  success: { icon: "check_circle", classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  info: { icon: "info", classes: "border-border bg-card text-foreground" },
};

/**
 * App-wide toast notifications, mounted once in the root layout. No new
 * dependency - this codebase already self-hosts everything else
 * (fonts, icons, the rich text editor), so a ~60-line toast is in
 * keeping with that rather than pulling in a library for one widget.
 *
 * Usage: `const toast = useToast(); toast(friendlyError(err), "error")`.
 * Pair with `friendly-error.ts` at call sites that currently show a raw
 * `err.message` (or silently swallow the error entirely).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "error") => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext value={toast}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-100 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
        role="region"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const meta = VARIANT_META[t.variant];
          return (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-[var(--shadow-raised)] animate-in fade-in slide-in-from-bottom-2 duration-200",
                meta.classes,
              )}
            >
              <Icon name={meta.icon} size={16} className="mt-0.5 shrink-0" />
              <p className="min-w-0 flex-1 leading-snug">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const toast = use(ToastContext);
  if (!toast) throw new Error("useToast must be used within ToastProvider");
  return toast;
}
