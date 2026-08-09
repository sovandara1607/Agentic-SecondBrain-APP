"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  Inbox,
  FileText,
  CheckSquare,
  FolderKanban,
  Calendar,
  Sparkles,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { signOut } from "@/app/(app)/actions";

type NavLeaf = {
  id: string;
  title: string;
  href: string;
  icon: LucideIcon;
};

type NavGroup = {
  heading?: string;
  items: NavLeaf[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: "dashboard", title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { id: "inbox", title: "Inbox", href: "/inbox", icon: Inbox },
    ],
  },
  {
    heading: "Workspace",
    items: [
      { id: "notes", title: "Notes", href: "/notes", icon: FileText },
      { id: "tasks", title: "Tasks", href: "/tasks", icon: CheckSquare },
      { id: "projects", title: "Projects", href: "/projects", icon: FolderKanban },
      { id: "calendar", title: "Calendar", href: "/calendar", icon: Calendar },
      { id: "reviews", title: "Reviews", href: "/reviews", icon: Sparkles },
    ],
  },
];

export const SETTINGS_ITEM: NavLeaf = {
  id: "settings",
  title: "Settings",
  href: "/settings",
  icon: Settings,
};

const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
const COLLAPSE_KEY = "second-brain:sidebar-collapsed";

function NavRow({
  item,
  active,
  collapsed,
  badge,
}: {
  item: NavLeaf;
  active: boolean;
  collapsed: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.title : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <item.icon className="size-4 shrink-0" strokeWidth={1.75} />
      {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
      {!collapsed && badge ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function AppSidebar({
  email,
  tier,
  badges = {},
}: {
  email: string;
  tier: string;
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Default to icon-only on narrow viewports, unless the person already
  // picked a state explicitly (persisted below). Reading localStorage/
  // matchMedia can only happen post-mount (server has no window), so this
  // one-time sync from a browser-only source has to live in an effect -
  // there's no state derivable at render time to use instead.
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(
      stored !== null
        ? stored === "true"
        : window.matchMedia("(max-width: 767px)").matches,
    );
  }, []);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      } else if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        router.push("/settings");
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setAccountOpen(false);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [router]);

  // Focusing the input has to wait until it's mounted post-open, but
  // resetting the query happens in openPalette() below instead of here -
  // no setState needed in this effect.
  useEffect(() => {
    if (paletteOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  function openPalette() {
    setQuery("");
    setPaletteOpen(true);
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, String(next));
      return next;
    });
  }

  const matches = ALL_ITEMS.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <aside
        className={cn(
          "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 motion-reduce:transition-none",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className="flex items-center gap-1 p-3">
          <button
            type="button"
            onClick={() => setAccountOpen((o) => !o)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sidebar-accent",
              collapsed && "justify-center",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
              {email.charAt(0).toUpperCase()}
            </span>
            {!collapsed && (
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium leading-tight text-sidebar-foreground">
                  {email}
                </span>
                <span className="text-[11px] leading-tight text-muted-foreground capitalize">
                  {tier} plan
                </span>
              </span>
            )}
          </button>
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <PanelLeftClose className="size-4" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {accountOpen && !collapsed && (
          <div className="mx-3 mb-2 flex flex-col gap-0.5 rounded-md border border-sidebar-border bg-sidebar p-1">
            <Link
              href="/settings"
              onClick={() => setAccountOpen(false)}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-sidebar-foreground/80 hover:bg-sidebar-accent"
            >
              Settings
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-sidebar-foreground/80 hover:bg-sidebar-accent"
              >
                <LogOut className="size-3.5" strokeWidth={1.75} />
                Sign out
              </button>
            </form>
          </div>
        )}

        {collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            className="mx-auto mb-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" strokeWidth={1.75} />
          </button>
        )}

        <button
          type="button"
          onClick={openPalette}
          title={collapsed ? "Search (⌘K)" : undefined}
          className={cn(
            "mx-3 mb-3 flex items-center gap-2.5 rounded-md border border-sidebar-border px-2.5 py-[7px] text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
            collapsed && "mx-auto justify-center border-0 px-1.5",
          )}
        >
          <Search className="size-4 shrink-0" strokeWidth={1.75} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search</span>
              <kbd className="rounded border border-sidebar-border bg-background px-1 font-mono text-[10px]">
                {"⌘K"}
              </kbd>
            </>
          )}
        </button>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3">
          {NAV_GROUPS.map((group, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              {group.heading && !collapsed && (
                <span className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                  {group.heading}
                </span>
              )}
              {group.items.map((item) => (
                <NavRow
                  key={item.id}
                  item={item}
                  collapsed={collapsed}
                  active={
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`)
                  }
                  badge={badges[item.id]}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <NavRow
            item={SETTINGS_ITEM}
            collapsed={collapsed}
            active={pathname === SETTINGS_ITEM.href}
          />
        </div>
      </aside>

      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/40 px-4 pt-[15vh] backdrop-blur-sm">
          <div
            className="absolute inset-0"
            onClick={() => setPaletteOpen(false)}
          />
          <div className="relative w-full max-w-lg animate-in fade-in zoom-in-95 duration-150 overflow-hidden rounded-xl border border-border bg-card shadow-2xl motion-reduce:animate-none">
            <div className="flex items-center border-b border-border px-4">
              <Search
                className="mr-3 size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0]) {
                    router.push(matches[0].href);
                    setPaletteOpen(false);
                  }
                }}
                placeholder="Jump to a page..."
                className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                aria-label="Close search"
                className="ml-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {matches.length ? (
                matches.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setPaletteOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    <item.icon
                      className="size-4 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                    {item.title}
                  </Link>
                ))
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Command
                    className="size-5 text-muted-foreground/50"
                    strokeWidth={1.75}
                  />
                  <p className="text-sm text-muted-foreground">
                    No pages match &quot;{query}&quot;.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
