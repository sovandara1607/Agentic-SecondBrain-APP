export type NavLeaf = {
  id: string;
  title: string;
  href: string;
  /** Material Symbols ligature name, rendered via components/ui/icon.tsx. */
  icon: string;
};

export type NavGroup = {
  heading?: string;
  items: NavLeaf[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: "dashboard", title: "Dashboard", href: "/dashboard", icon: "dashboard" },
      { id: "inbox", title: "Inbox", href: "/inbox", icon: "inbox" },
      { id: "search", title: "Search", href: "/search", icon: "search" },
    ],
  },
  {
    heading: "Workspace",
    items: [
      { id: "notes", title: "Notes", href: "/notes", icon: "description" },
      { id: "tasks", title: "Tasks", href: "/tasks", icon: "check_box" },
      { id: "projects", title: "Projects", href: "/projects", icon: "folder_special" },
      { id: "calendar", title: "Calendar", href: "/calendar", icon: "calendar_month" },
      { id: "graph", title: "Graph", href: "/graph", icon: "hub" },
      { id: "reviews", title: "Reviews", href: "/reviews", icon: "auto_awesome" },
      { id: "workspace", title: "AI Workspace", href: "/workspace", icon: "forum" },
    ],
  },
];

export const SETTINGS_ITEM: NavLeaf = {
  id: "settings",
  title: "Settings",
  href: "/settings",
  icon: "settings",
};

export const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
