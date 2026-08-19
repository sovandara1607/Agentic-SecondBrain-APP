// Shared between the command palette (components/app-sidebar.tsx) and
// the dedicated /search page - one place for how a hybrid_search result
// (apps/api/routers/search.py) maps to a route and an icon, so the two
// surfaces can't quietly drift apart on what a "task" result links to.
export type SearchResult = {
  content_type: string;
  content_id: string;
  title: string;
  snippet: string;
  score?: number;
};

export const SEARCH_HREF: Record<string, (id: string) => string | null> = {
  note: (id) => `/notes/${id}`,
  task: (id) => `/tasks/${id}`,
  project: () => `/projects`, // no detail route yet, only a list page
  document: () => null,
};

export const SEARCH_ICON: Record<string, string> = {
  note: "description",
  task: "check_box",
  project: "folder_special",
  document: "draft",
};
