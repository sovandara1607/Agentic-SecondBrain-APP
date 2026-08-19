"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";

const THEME_KEY = "second-brain:theme";

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [isDark, setIsDark] = useState(false);
  const { t } = useLocale();

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
      title={collapsed ? t("toggleTheme") : undefined}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon name={isDark ? "light_mode" : "dark_mode"} size={16} />
      {!collapsed && (
        <span className="flex-1 text-left">
          {isDark ? t("lightMode") : t("darkMode")}
        </span>
      )}
    </button>
  );
}
