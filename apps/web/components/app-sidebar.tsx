"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
  X,
  Menu,
  Brain,
  GitBranch,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { signOut } from "@/app/(app)/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { PageBreadcrumb } from "@/components/page-breadcrumb";

import {
  NAV_GROUPS,
  SETTINGS_ITEM,
  ALL_ITEMS,
  type NavLeaf,
} from "@/components/nav-config";

const COLLAPSE_KEY = "second-brain:sidebar-collapsed";

function NavRow({
  item,
  active,
  collapsed,
  badge,
  onNavigate,
}: {
  item: NavLeaf;
  active: boolean;
  collapsed: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.title : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors font-medium",
        collapsed && "justify-center px-0",
        active
          ? "bg-primary/10 text-primary font-semibold shadow-xs"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <item.icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-primary" : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground",
        )}
        strokeWidth={1.75}
      />
      {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
      {!collapsed && badge ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function AppShell({
  email,
  tier,
  badges = {},
  children,
}: {
  email: string;
  tier: string;
  badges?: Record<string, number>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "v0.1.0";

  // Close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Sync collapsed state with localStorage safely
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(COLLAPSE_KEY);
      setCollapsed(
        stored !== null
          ? stored === "true"
          : window.matchMedia("(max-width: 767px)").matches,
      );
    }
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
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [router]);

  useEffect(() => {
    if (paletteOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  function openPalette() {
    setQuery("");
    setPaletteOpen(true);
    setMobileOpen(false);
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(COLLAPSE_KEY, String(next));
      }
      return next;
    });
  }

  const matches = ALL_ITEMS.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase()),
  );

  const sidebarContent = (isMobile = false) => {
    const isCollapsed = isMobile ? false : collapsed;
    return (
      <aside
        className={cn(
          "relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar shadow-xs transition-[width] duration-200 motion-reduce:transition-none",
          isMobile ? "w-72" : isCollapsed ? "w-16" : "w-60",
        )}
      >
        {/* Account Header */}
        <div className="flex items-center gap-1 p-3">
          <button
            type="button"
            onClick={() => setAccountOpen((o) => !o)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sidebar-accent",
              isCollapsed && "justify-center",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-b from-[color-mix(in_oklch,var(--primary),white_16%)] to-primary text-xs font-semibold text-primary-foreground shadow-xs">
              {email.charAt(0).toUpperCase()}
            </span>
            {!isCollapsed && (
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold leading-tight text-sidebar-foreground">
                  {email}
                </span>
                <span className="text-[11px] leading-tight text-sidebar-foreground/60 capitalize">
                  {tier} plan
                </span>
              </span>
            )}
          </button>
          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="shrink-0 rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <X className="size-5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {accountOpen && !isCollapsed && (
          <div className="mx-3 mb-2 flex flex-col gap-0.5 rounded-md border border-sidebar-border bg-sidebar-accent/30 p-1">
            <Link
              href="/settings"
              onClick={() => {
                setAccountOpen(false);
                setMobileOpen(false);
              }}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent font-medium"
            >
              Settings
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent font-medium"
              >
                <LogOut className="size-3.5" strokeWidth={1.75} />
                Sign out
              </button>
            </form>
          </div>
        )}

        {/* Quick Search Button */}
        <button
          type="button"
          onClick={openPalette}
          title={isCollapsed ? "Search (⌘K)" : undefined}
          className={cn(
            "mx-3 mb-3 flex items-center gap-2.5 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-[7px] text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground font-medium",
            isCollapsed && "mx-auto justify-center border-0 bg-transparent px-1.5 shadow-none",
          )}
        >
          <Search className="size-4 shrink-0 text-sidebar-foreground/60" strokeWidth={1.75} />
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left">Search</span>
              <kbd className="rounded border border-sidebar-border bg-background/80 px-1 font-mono text-[10px] text-sidebar-foreground/70">
                {"⌘K"}
              </kbd>
            </>
          )}
        </button>

        {/* Navigation Items */}
        <nav className="flex flex-col gap-4 overflow-y-auto px-3 flex-1">
          {NAV_GROUPS.map((group, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              {group.heading && !isCollapsed && (
                <span className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-foreground/60 uppercase">
                  {group.heading}
                </span>
              )}
              {group.items.map((item) => (
                <NavRow
                  key={item.id}
                  item={item}
                  collapsed={isCollapsed}
                  onNavigate={() => setMobileOpen(false)}
                  active={
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`)
                  }
                  badge={badges[item.id]}
                />
              ))}
            </div>
          ))}

          <div className="flex flex-col gap-0.5 border-t border-sidebar-border pt-3">
            <ThemeToggle collapsed={isCollapsed} />
            <NavRow
              item={SETTINGS_ITEM}
              collapsed={isCollapsed}
              onNavigate={() => setMobileOpen(false)}
              active={pathname === SETTINGS_ITEM.href}
            />
          </div>
        </nav>

        {/* Sidebar Footer Version Indicator (Configurable via git/env) */}
        <div
          className={cn(
            "flex items-center border-t border-sidebar-border px-3 py-2.5 text-[11px] font-mono text-sidebar-foreground/60",
            isCollapsed ? "justify-center px-1" : "justify-between"
          )}
          title={`Version ${appVersion}`}
        >
          <span className="flex items-center gap-1.5">
            <GitBranch className="size-3 text-sidebar-foreground/50 shrink-0" />
            {!isCollapsed && <span>{appVersion}</span>}
          </span>
        </div>
      </aside>
    );
  };

  return (
    <div className="flex h-dvh flex-col md:flex-row bg-background">
      {/* Desktop Sidebar (visible on md and larger) */}
      <div className="hidden md:block h-full shrink-0">
        {sidebarContent(false)}
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 animate-in slide-in-from-left duration-200">
            {sidebarContent(true)}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Header Bar with Outside Sidebar Collapse Toggle */}
        <header className="flex shrink-0 items-center border-b border-border/60 px-4 sm:px-6 py-2.5 sm:py-3 gap-3 bg-card/50">
          {/* Desktop Outside Sidebar Toggle Button */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.75} />
            )}
          </button>

          {/* Mobile Drawer Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="flex md:hidden items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Menu className="size-5" strokeWidth={1.75} />
          </button>

          <PageBreadcrumb />
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>

      {/* Command Palette Modal */}
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
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted font-medium"
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
    </div>
  );
}
