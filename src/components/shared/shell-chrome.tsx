"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Building2Icon, MenuIcon } from "lucide-react";

import { useT } from "@/components/i18n/i18n-provider";
import { Logo } from "@/components/shared/logo";
import { AreaTabsBar, BottomNav, NavLinks } from "@/components/shared/nav-links";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserMenu } from "@/features/auth/user-menu";
import { LanguageSelector } from "@/features/i18n/language-selector";
import { NotificationBell } from "@/features/notifications/notification-bell";
import type { UserRole } from "@/generated/prisma/enums";
import { MOBILE_PRIMARY, type NavItem, isNavActive, tabsFor } from "@/lib/nav";

/** Roles with an alert feed behind `/api/v1/me/alerts`. */
const HAS_ALERTS: readonly UserRole[] = ["TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF"];

export type ShellUser = { name: string; email: string; role: UserRole; profileHref: Route };

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

/** The sidebar's contents, shared by the desktop rail and the phone drawer. */
function SidebarBody({ nav, schoolName, user, onNavigate }: { nav: NavItem[]; schoolName: string; user: ShellUser; onNavigate?: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 px-5 pt-5 pb-4">
        <Link href="/" aria-label="SchoolOS home" className="w-fit">
          <Logo />
        </Link>
        <div className="bg-sidebar-accent flex items-center gap-2.5 rounded-xl px-3 py-2.5">
          <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Building2Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold" title={schoolName}>
              {schoolName}
            </span>
            <span className="text-muted-foreground block text-xs">{t(`role.${user.role}`)}</span>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavLinks items={nav} onNavigate={onNavigate} />
      </div>
      <div className="border-sidebar-border flex items-center gap-2 border-t px-4 py-3">
        <Link href={user.profileHref} onClick={onNavigate} className="hover:bg-sidebar-accent flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5">
          <span className="bg-purple-soft text-purple-strong flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold" aria-hidden>
            {initialsOf(user.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="text-muted-foreground block truncate text-xs">{t("common.myProfile")}</span>
          </span>
        </Link>
        <ThemeToggle />
      </div>
    </div>
  );
}

/**
 * The interactive parts of the signed-in layout.
 *
 * Wide screens: a slim sidebar (brand, school, navigation, the person with a
 * theme switch) and a header (the section's title, notifications, language,
 * theme, account menu). Phones: the sidebar folds into a drawer behind the
 * menu button, and a bottom bar holds the four places people go most, with
 * "More" opening the drawer. Screens that share a sidebar entry get a row of
 * tabs above their content.
 *
 * All of it is presentation. Which links appear is decided on the server from
 * the role (and, for staff, their permissions); every page re-checks access.
 */
export function ShellChrome({
  nav,
  schoolName,
  user,
  children,
}: {
  nav: NavItem[];
  schoolName: string;
  user: ShellUser;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const area = tabsFor(user.role, pathname);
  const current = nav.find((item) => isNavActive(item, pathname));
  const primary = (MOBILE_PRIMARY[user.role] ?? [])
    .map((href) => nav.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item))
    .slice(0, 4);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-lg px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("common.skipToContent")}
      </a>

      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden shrink-0 border-r md:sticky md:top-0 md:block md:h-dvh md:w-64 print:hidden">
        <SidebarBody nav={nav} schoolName={schoolName} user={user} />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="bg-sidebar w-[min(18rem,85vw)] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("common.menu")}</SheetTitle>
          </SheetHeader>
          <SidebarBody nav={nav} schoolName={schoolName} user={user} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/85 sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-4 backdrop-blur md:px-8 print:hidden">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("common.menu")} onClick={() => setOpen(true)}>
            <MenuIcon className="size-5" aria-hidden />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{current ? t(current.labelKey) : schoolName}</p>
            <p className="text-muted-foreground truncate text-xs md:hidden">{schoolName}</p>
          </div>
          <div className="flex items-center gap-0.5">
            {HAS_ALERTS.includes(user.role) ? <NotificationBell /> : null}
            <LanguageSelector />
            <span className="hidden md:inline-flex">
              <ThemeToggle />
            </span>
            <UserMenu name={user.name} email={user.email} role={user.role} profileHref={user.profileHref} />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 pt-6 pb-24 outline-none md:px-8 md:pb-10 print:p-0">
          <div className="mx-auto w-full max-w-7xl">
            {area ? <AreaTabsBar tabs={area.tabs} active={area.active} /> : null}
            {children}
          </div>
        </main>
      </div>

      {primary.length ? <BottomNav items={primary} onMore={() => setOpen(true)} /> : null}
    </div>
  );
}
