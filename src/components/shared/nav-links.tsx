"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3Icon,
  BookOpenIcon,
  Building2Icon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  ClockIcon,
  CircleUserIcon,
  GlobeIcon,
  HeartHandshakeIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MegaphoneIcon,
  KeyRoundIcon,
  ScrollTextIcon,
  TagIcon,
  UserCogIcon,
  UserPlusIcon,
  UsersIcon,
  WalletCardsIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavIcon, NavItem } from "@/lib/nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  schools: Building2Icon,
  offers: TagIcon,
  audit: ScrollTextIcon,
  plans: WalletCardsIcon,
  students: UsersIcon,
  teachers: UserCogIcon,
  academics: BookOpenIcon,
  timetable: ClockIcon,
  attendance: ClipboardCheckIcon,
  reports: BarChart3Icon,
  notices: MegaphoneIcon,
  events: CalendarDaysIcon,
  admissions: UserPlusIcon,
  website: GlobeIcon,
  account: CircleUserIcon,
  tokens: KeyRoundIcon,
  children: HeartHandshakeIcon,
};

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible"
    >
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = ICONS[item.icon];

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
