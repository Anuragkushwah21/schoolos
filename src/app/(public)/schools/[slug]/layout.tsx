import type { Route } from "next";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublicPages, getPublicSchool, safeColor } from "@/server/website/public";

/**
 * A school's own public website.
 *
 * Only ACTIVE schools render: a pending, rejected or suspended school is a 404
 * to the outside world. The slug picks which school to show and nothing else —
 * no private data is reachable from these pages at all.
 */

export async function generateMetadata(props: LayoutProps<"/schools/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) return {};

  return {
    title: { default: school.name, template: `%s · ${school.name}` },
    description:
      school.about?.slice(0, 160) ??
      `${school.name}${school.city ? `, ${school.city}` : ""} — admissions, notices and events.`,
  };
}

export default async function SchoolSiteLayout(props: LayoutProps<"/schools/[slug]">) {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const pages = await getPublicPages(school.id);
  const base = `/schools/${school.slug}`;

  const nav = [
    { href: base, label: "Home" },
    ...pages.map((page) => ({ href: `${base}/${page.slug}`, label: page.title })),
    { href: `${base}/notices`, label: "Notices" },
    { href: `${base}/events`, label: "Events" },
    { href: `${base}/admissions`, label: "Admissions" },
    { href: `${base}/contact`, label: "Contact" },
  ];

  return (
    <div
      className="flex min-h-full flex-1 flex-col"
      // The school's own colours, applied as theme variables so every button
      // and link on their site follows them. Only valid hex reaches the DOM.
      style={
        {
          "--primary": safeColor(school.primaryColor, "#1e40af"),
          "--ring": safeColor(school.primaryColor, "#1e40af"),
          "--school-accent": safeColor(school.secondaryColor, "#f59e0b"),
        } as React.CSSProperties
      }
    >
      <header className="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href={base as Route} className="flex min-w-0 items-center gap-3">
            {school.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a school-supplied URL, not a bundled asset
              <img src={school.logoUrl} alt="" className="size-10 shrink-0 rounded-lg object-contain" />
            ) : (
              <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg font-semibold">
                {(school.shortName ?? school.name).slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-semibold">{school.name}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {[school.affiliationBoard, school.city].filter(Boolean).join(" · ")}
              </span>
            </span>
          </Link>
        </div>
        <nav aria-label="School site" className="border-t">
          <ul className="text-muted-foreground mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-2 text-sm sm:px-4">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href as Route}
                  className="hover:text-foreground hover:border-primary block border-b-2 border-transparent px-3 py-2.5 whitespace-nowrap transition-colors"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="flex-1">{props.children}</main>

      <footer className="bg-muted/40 mt-16 border-t">
        <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-10 text-sm sm:px-6 md:grid-cols-3">
          <div>
            <p className="font-semibold">{school.name}</p>
            <p className="text-muted-foreground mt-1">
              {[school.addressLine, school.city, school.state, school.postalCode].filter(Boolean).join(", ")}
            </p>
          </div>
          <div className="text-muted-foreground">
            {school.phone ? <p>{school.phone}</p> : null}
            {school.email ? <p className="break-all">{school.email}</p> : null}
          </div>
          <div className="text-muted-foreground md:text-right">
            <Link href={`${base}/admissions` as Route} className="text-primary font-medium hover:underline">
              Apply for admission
            </Link>
            <p className="mt-2 text-xs">
              Powered by{" "}
              <Link href="/" className="hover:underline">
                SchoolOS
              </Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
