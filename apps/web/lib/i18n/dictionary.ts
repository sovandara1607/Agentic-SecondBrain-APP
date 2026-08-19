export type Locale = "en" | "km";

/**
 * UI-chrome-only translations: everything the app itself writes (nav,
 * common actions, shared labels). Deliberately not attempting to cover
 * user data (note/task content, AI-generated review text) - that's
 * either the user's own words or the AI's own output (see
 * ai_core/i18n.py's language instruction for that half), not a fixed
 * string this dictionary could translate correctly anyway.
 */
// Cross-checked against Google Translate (translate.googleapis.com) term
// by term. Most matched exactly; two deliberate overrides kept where a
// single-word MT query lost context a short UI label still needs:
// - signOut: Google gives "ចេញ" ("out"/"exit") for "Sign out" in
//   isolation - too terse to read as "log out of your account" on its
//   own. "ចាកចេញ" is the fuller phrase major Khmer-localized apps use
//   for this exact action.
// - toggleTheme: Google gives "បិទបើកប្រធានបទ" for "Toggle theme" -
//   "ប្រធានបទ" means "topic/subject", the wrong sense of "theme"
//   entirely (it translated the essay-writing meaning, not the UI one).
export const DICTIONARY = {
  // Nav (keys match nav-config.ts's NavLeaf.id)
  dashboard: { en: "Dashboard", km: "ផ្ទាំងគ្រប់គ្រង" },
  inbox: { en: "Inbox", km: "ប្រអប់សំបុត្រ" },
  notes: { en: "Notes", km: "កំណត់ចំណាំ" },
  tasks: { en: "Tasks", km: "កិច្ចការ" },
  projects: { en: "Projects", km: "គម្រោង" },
  calendar: { en: "Calendar", km: "ប្រតិទិន" },
  graph: { en: "Graph", km: "ក្រាហ្វ" },
  reviews: { en: "Reviews", km: "ពិនិត្យ" },
  workspace: { en: "AI Workspace", km: "កន្លែងធ្វើការ AI" },
  settings: { en: "Settings", km: "ការកំណត់" },
  knowledgeGraph: { en: "Knowledge Graph", km: "ក្រាហ្វចំណេះដឹង" },
  welcomeBack: { en: "Welcome back", km: "សូមស្វាគមន៍ការត្រឡប់មកវិញ" },

  // Common actions, used broadly across pages/buttons
  save: { en: "Save", km: "រក្សាទុក" },
  cancel: { en: "Cancel", km: "បោះបង់" },
  delete: { en: "Delete", km: "លុប" },
  create: { en: "Create", km: "បង្កើត" },
  edit: { en: "Edit", km: "កែសម្រួល" },
  add: { en: "Add", km: "បន្ថែម" },
  search: { en: "Search", km: "ស្វែងរក" },

  // Sidebar chrome
  signOut: { en: "Sign out", km: "ចាកចេញ" },
  lightMode: { en: "Light mode", km: "របៀបពន្លឺ" },
  darkMode: { en: "Dark mode", km: "របៀបងងឹត" },
  toggleTheme: { en: "Toggle theme", km: "ប្តូររបៀបបង្ហាញ" },
  freePlan: { en: "Free Plan", km: "ផែនការឥតគិតថ្លៃ" },
  switchLanguage: { en: "Switch language", km: "ប្តូរភាសា" },

  // Compound button labels (Google-Translate-checked, see note above)
  saveChanges: { en: "Save changes", km: "រក្សាទុកការផ្លាស់ប្តូរ" },
  savePreferences: { en: "Save preferences", km: "រក្សាទុកចំណូលចិត្ត" },
  saveNote: { en: "Save note", km: "រក្សាទុកចំណាំ" },
  createProject: { en: "Create project", km: "បង្កើតគម្រោង" },
  scheduleTask: { en: "Schedule Task", km: "កំណត់ពេលភារកិច្ច" },
  searchResults: { en: "Search results", km: "លទ្ធផលស្វែងរក" },
  noResultsFound: { en: "No results found", km: "រកមិនឃើញលទ្ធផលទេ។" },
  searchPrompt: {
    en: "Search your notes, tasks, and projects",
    km: "ស្វែងរកកំណត់ចំណាំ កិច្ចការ និងគម្រោងរបស់អ្នក។",
  },
  documents: { en: "Documents", km: "ឯកសារ" },

  // Onboarding (Dashboard's empty-account welcome card)
  onboardingTitle: { en: "Welcome to your second brain", km: "សូមស្វាគមន៍មកកាន់ខួរក្បាលទីពីររបស់អ្នក" },
  onboardingBody: {
    en: "Capture anything - a thought, a link, a voice memo - and the AI pipeline organizes it into notes, tasks, and tags automatically.",
    km: "ចាប់យកអ្វីទាំងអស់ - គំនិត តំណ អនុសរណៈសំឡេង - ហើយបំពង់ AI រៀបចំវាទៅជាកំណត់ចំណាំ កិច្ចការ និងស្លាកដោយស្វ័យប្រវត្តិ",
  },
  onboardingCapture: { en: "Capture your first note", km: "ចាប់យកកំណត់ត្រាដំបូងរបស់អ្នក" },
  onboardingCreateProject: { en: "Create a project", km: "បង្កើតគម្រោងមួយ" },
} as const;

export type DictionaryKey = keyof typeof DICTIONARY;
