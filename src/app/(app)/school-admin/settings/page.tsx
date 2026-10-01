import type { Metadata, Route } from "next";
import Link from "next/link";
import {
  BookOpenIcon,
  BuildingIcon,
  CalendarOffIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  DownloadIcon,
  KeyRoundIcon,
  LayersIcon,
  ListChecksIcon,
  type LucideIcon,
  ReceiptIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserCogIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import type { MessageKey } from "@/lib/i18n/translate";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Settings" };

const ITEMS: Array<{ href: Route; icon: LucideIcon; title: MessageKey; hint: MessageKey; download?: boolean }> = [
  { href: "/school-admin/setup", icon: ListChecksIcon, title: "settings.setup", hint: "settings.setupHint" },
  { href: "/school-admin/website", icon: BuildingIcon, title: "settings.profile", hint: "settings.profileHint" },
  { href: "/school-admin/academics", icon: BookOpenIcon, title: "settings.academicYear", hint: "settings.academicYearHint" },
  { href: "/school-admin/academics/classes", icon: LayersIcon, title: "settings.classes", hint: "settings.classesHint" },
  { href: "/school-admin/settings/attendance", icon: ClipboardCheckIcon, title: "settings.attendance", hint: "settings.attendanceHint" },
  { href: "/school-admin/holidays", icon: CalendarOffIcon, title: "settings.calendar", hint: "settings.calendarHint" },
  { href: "/school-admin/finance/receipts", icon: ReceiptIcon, title: "settings.fees", hint: "settings.feesHint" },
  { href: "/school-admin/staff", icon: ShieldCheckIcon, title: "settings.staffAccess", hint: "settings.staffAccessHint" },
  { href: "/school-admin/settings/export" as Route, icon: DownloadIcon, title: "settings.exportData", hint: "settings.exportDataHint", download: true },
  { href: "/school-admin/audit", icon: ScrollTextIcon, title: "settings.auditLog", hint: "settings.auditLogHint" },
  { href: "/api-tokens", icon: KeyRoundIcon, title: "settings.apiTokens", hint: "settings.apiTokensHint" },
  { href: "/account", icon: UserCogIcon, title: "settings.account", hint: "settings.accountHint" },
];

/**
 * The setup a school does rarely, gathered in one place so it does not crowd
 * the sidebar. Each card opens the existing screen, which keeps its own guard.
 */
export default async function SettingsPage() {
  await requireTenant("SCHOOL_ADMIN");
  const t = await getT();

  return (
    <>
      <PageHeader icon={SettingsIcon} tone="neutral" title={t("settings.title")} description={t("settings.description")} />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ITEMS.map(({ href, icon: Icon, title, hint, download }) => (
          <li key={title}>
            <Link
              href={href}
              prefetch={download ? false : undefined}
              className="bg-card hover:border-primary/40 focus-visible:ring-ring flex h-full items-start gap-4 rounded-xl border p-5 shadow-[0_1px_3px_rgb(15_23_42/0.06)] transition-colors"
            >
              <span className="bg-primary-soft text-primary-strong flex size-10 shrink-0 items-center justify-center rounded-lg">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t(title)}</span>
                <span className="text-muted-foreground mt-0.5 block text-sm">{t(hint)}</span>
              </span>
              <ChevronRightIcon className="text-muted-foreground mt-2.5 size-4 shrink-0" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
