import {
  LayoutDashboard,
  Inbox,
  FileText,
  CheckSquare,
  FolderKanban,
  Calendar,
  Sparkles,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavLeaf = {
  id: string;
  title: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
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
      { id: "workspace", title: "AI Workspace", href: "/workspace", icon: MessageSquare },
    ],
  },
];

export const SETTINGS_ITEM: NavLeaf = {
  id: "settings",
  title: "Settings",
  href: "/settings",
  icon: Settings,
};

export const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
