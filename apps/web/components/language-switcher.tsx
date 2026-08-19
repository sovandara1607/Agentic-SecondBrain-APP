"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";

// Mirrors theme-toggle.tsx's layout/markup on purpose - same sidebar
// row, same collapsed-state handling, right below it in app-sidebar.tsx.
export function LanguageSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  const next = locale === "en" ? "km" : "en";

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      title={collapsed ? t("switchLanguage") : undefined}
      aria-label={`${t("switchLanguage")}: ${next === "km" ? "ភាសាខ្មែរ" : "English"}`}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon name="translate" size={16} />
      {!collapsed && (
        // Label reads as "what you'll switch to", not "what's active
        // now" - the common convention (same as most apps' language
        // pickers), and lets someone who can't read the current
        // language yet still recognize their own language's name.
        <span className="flex-1 text-left">{next === "km" ? "ភាសាខ្មែរ" : "English"}</span>
      )}
    </button>
  );
}
