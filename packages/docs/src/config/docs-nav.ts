/**
 * Docs navigation model. Drives the top nav, the left sidebar tree, and active
 * states. Mirrors the IA in design/website.pen (Start here / Guides / Reference).
 */
export interface NavItem {
  label: string;
  href: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const sidebarNav: NavGroup[] = [
  {
    label: "Start here",
    items: [
      { label: "Introduction", href: "/introduction" },
      { label: "Getting started", href: "/getting-started" },
    ],
  },
  {
    label: "Guides",
    items: [
      { label: "Defining schemas", href: "/guides/schemas" },
      { label: "Migrations", href: "/guides/migrations" },
      { label: "Codecs & BYO types", href: "/guides/codecs" },
      { label: "Drift & verify", href: "/guides/drift-verify" },
    ],
  },
  {
    label: "Reference",
    items: [
      { label: "CLI", href: "/reference/cli" },
      { label: "sz.* API", href: "/reference/api" },
      { label: "DDL mapping", href: "/reference/ddl-mapping" },
    ],
  },
];

export const topNav: NavItem[] = [
  { label: "Docs", href: "/introduction" },
  { label: "Guides", href: "/guides/schemas" },
  { label: "Reference", href: "/reference/cli" },
  { label: "API", href: "/reference/api" },
];

export interface TocItem {
  id: string;
  text: string;
}
