"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

const THEME_KEY = "second-brain:theme";

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [isDark, setIsDark] = useState(false);

  // Mirrors whatever the beforeInteractive script in app/layout.tsx already
  // set on <html> before hydration - reading that once on mount is syncing
  // with external DOM state, not deriving it from anything React owns.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={collapsed ? "Toggle theme" : undefined}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {isDark ? (
        <Sun className="size-4 shrink-0" strokeWidth={1.75} />
      ) : (
        <Moon className="size-4 shrink-0" strokeWidth={1.75} />
      )}
      {!collapsed && (
        <span className="flex-1 text-left">
          {isDark ? "Light mode" : "Dark mode"}
        </span>
      )}
    </button>
  );
}
