"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";

import { useT } from "@/components/i18n/i18n-provider";
import { NAV_ICONS } from "@/components/shared/nav-icons";
import { type AreaTab, type NavItem, isNavActive } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** The sidebar list. `onNavigate` lets the mobile drawer close itself. */
export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useT();

  return (
    <nav aria-label={t("nav.main")} className="flex flex-col gap-0.5 px-3 pb-4">
      {items.map((item) => {
        const active = isNavActive(item, pathname);
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-[0.9rem] transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Tabs across the top of screens that share one sidebar entry. */
export function AreaTabsBar({ tabs, active }: { tabs: AreaTab[]; active: Route }) {
  const t = useT();
  return (
    <nav aria-label={t("common.more")} className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b px-1 print:hidden">
      {tabs.map((tab) => {
        const current = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px min-h-10 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              current ? "border-primary text-primary-strong font-semibold" : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/** A phone's bottom bar: the day's main destinations, and "More" for the rest. */
export function BottomNav({ items, onMore }: { items: NavItem[]; onMore: () => void }) {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav
      aria-label={t("nav.main")}
      className="bg-surface fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      {items.map((item) => {
        const active = isNavActive(item, pathname);
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[0.7rem] leading-tight",
              active ? "text-primary-strong font-semibold" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
            <span className="max-w-full truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className="text-muted-foreground flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem]">
        <MenuIcon className="size-5" aria-hidden />
        {t("common.more")}
      </button>
    </nav>
  );
}
