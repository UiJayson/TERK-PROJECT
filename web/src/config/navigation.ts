export interface NavItem {
  label: string;
  path: string;
  icon: string;
  /** restrict visibility to these roles (default: everyone) */
  roles?: readonly string[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** Sectioned sidebar navigation. Every path maps to a real registered route. */
export const navSections: NavSection[] = [
  {
    label: "Home",
    items: [
      { label: "Overview", path: "/app", icon: "home" },
      { label: "Analytics", path: "/app/analytics", icon: "chart" },
    ],
  },
  {
    label: "Agents",
    items: [{ label: "My Agents", path: "/app/agents", icon: "agents" }],
  },
  {
    label: "Operations",
    items: [
      { label: "Conversations", path: "/app/conversations", icon: "chat" },
      { label: "Leads", path: "/app/leads", icon: "users" },
      { label: "Knowledge Base", path: "/app/knowledge", icon: "book" },
      { label: "Channels", path: "/app/channels", icon: "channels" },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Onboarding", path: "/app/onboarding", icon: "book" },
      { label: "Validation", path: "/app/validation", icon: "chat" },
      { label: "Deployment gate", path: "/app/deployment", icon: "spark" },
      { label: "Modules", path: "/app/modules", icon: "plug" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Integrations", path: "/app/integrations", icon: "plug" },
      { label: "Billing", path: "/app/billing", icon: "card" },
      { label: "System Health", path: "/app/system-health", icon: "spark", roles: ["owner"] },
      { label: "Admin Health", path: "/app/admin/health", icon: "spark", roles: ["owner"] },
      { label: "Settings", path: "/app/settings", icon: "gear" },
    ],
  },
];

/** Flat list (used for page titles and the mobile drawer). */
export const appNavItems: NavItem[] = navSections.flatMap((section) => section.items);

/** Mobile bottom navigation: the five highest-traffic destinations. */
export const bottomNavItems: NavItem[] = [
  { label: "Home", path: "/app", icon: "home" },
  { label: "Chats", path: "/app/conversations", icon: "chat" },
  { label: "Agents", path: "/app/agents", icon: "agents" },
  { label: "Analytics", path: "/app/analytics", icon: "chart" },
  { label: "Settings", path: "/app/settings", icon: "gear" },
];
