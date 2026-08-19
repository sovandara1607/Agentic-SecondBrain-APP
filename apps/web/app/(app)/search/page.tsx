"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/empty-state";
import { useLocale } from "@/lib/i18n/locale-provider";
import { friendlyError } from "@/lib/friendly-error";
import { SEARCH_HREF, SEARCH_ICON, type SearchResult } from "@/lib/search-result";

const TYPE_FILTERS = [
  { value: "all", icon: "apps", labelKey: "searchResults" },
  { value: "note", icon: "description", labelKey: "notes" },
  { value: "task", icon: "check_box", labelKey: "tasks" },
  { value: "project", icon: "folder_special", labelKey: "projects" },
  { value: "document", icon: "draft", labelKey: "documents" },
] as const;

// A dedicated page for the same GET /search (ai_core/search.py's
// hybrid_search) the command palette already calls - the palette is
// built for "jump somewhere fast then get out of the way" (closes on
// navigate, no room for filters), this is for actually digging through
// results: a real URL you can share/bookmark, type filtering, and
// nothing disappearing the moment you click a result.
export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const supabase = createClient();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    const params = new URLSearchParams(searchParams.toString());
    if (trimmed) params.set("q", trimmed);
    else params.delete("q");
    router.replace(`/search${params.toString() ? `?${params}` : ""}`, { scroll: false });

    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setError("Your session has expired. Please sign in again.");
          return;
        }
        const apiUrl = process.env.NEXT_PUBLIC_API_URL!;
        const res = await fetch(`${apiUrl}/search?q=${encodeURIComponent(trimmed)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.detail || `Search failed (${res.status})`);
        }
        setResults(body.results ?? []);
        setSearched(true);
      } catch (err) {
        console.error("search page query failed:", err);
        setError(friendlyError(err));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filtered = typeFilter === "all" ? results : results.filter((r) => r.content_type === typeFilter);
  const counts = TYPE_FILTERS.map((f) => ({
    ...f,
    count: f.value === "all" ? results.length : results.filter((r) => r.content_type === f.value).length,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{t("searchResults")}</h1>
        <p className="text-sm text-muted-foreground">{t("searchPrompt")}</p>
      </div>

      <div className="relative">
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPrompt")}
          className="pl-10"
        />
      </div>

      {results.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {counts.map((f) => (
            <Button
              key={f.value}
              type="button"
              size="sm"
              variant={typeFilter === f.value ? "secondary" : "ghost"}
              onClick={() => setTypeFilter(f.value)}
              className="gap-1.5"
            >
              <Icon name={f.icon} size={14} />
              {t(f.labelKey)}
              <span className="text-xs text-muted-foreground">({f.count})</span>
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Icon name="progress_activity" size={18} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </p>
        ) : searched && filtered.length === 0 ? (
          <EmptyState icon="search_off" title={t("noResultsFound")} description={t("searchPrompt")} />
        ) : (
          filtered.map((r) => {
            const href = SEARCH_HREF[r.content_type]?.(r.content_id);
            const content = (
              <>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon name={SEARCH_ICON[r.content_type] ?? "search"} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  {r.snippet && (
                    <span className="block truncate text-xs text-muted-foreground">{r.snippet}</span>
                  )}
                </span>
              </>
            );
            return href ? (
              <Link
                key={`${r.content_type}-${r.content_id}`}
                href={href}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 shadow-xs transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                {content}
              </Link>
            ) : (
              <div
                key={`${r.content_type}-${r.content_id}`}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 opacity-70 shadow-xs"
              >
                {content}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
