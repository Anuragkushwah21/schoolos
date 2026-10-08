import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  ClipboardCheckIcon,
  ClipboardPlusIcon,
  HandshakeIcon,
  MegaphoneIcon,
  ReceiptTextIcon,
  UserCogIcon,
  UserPlusIcon,
  UserRoundPlusIcon,
  WalletIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { QuickActions } from "@/components/shared/quick-actions";
import { Button } from "@/components/ui/button";
import {
  AcademicSection,
  FinanceSection,
  NeedsActionSection,
  SalariesSection,
  SectionSkeleton,
  StaffSection,
  StaffWorkspacesSection,
  StudentsSection,
  TodaySection,
} from "@/features/dashboard/admin-dashboard";
import { SchoolLifeCards } from "@/features/dashboard/school-life";
import { SetupProgressCard } from "@/features/school/setup-progress";
import { formatDayShort } from "@/lib/dates";
import { greetingKey } from "@/lib/greeting";
import { setupReport } from "@/server/academics/setup";
import { getCurrentSession } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { hrefAllowed } from "@/lib/school-modules";
import { schoolModules } from "@/server/platform/modules";
import { getIntlLocale, getT } from "@/server/i18n";

export const metadata: Metadata = { title: "School dashboard" };

/**
 * The School Admin's home, built for working from, not only reading:
 *
 *   * the welcome bar with the two things done most (collect a fee, see
 *     today's attendance);
 *   * today's figures in one strip;
 *   * daily tasks as one row of buttons;
 *   * then two columns on wide screens — the picture on the left (academics,
 *     money, students, staff workspaces), and on the right what needs a
 *     decision, who is in today, and what is coming up.
 *
 * Each section streams in on its own, so a slow one never holds up the rest.
 */
export default async function AdminDashboardPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [t, intl, session, setup, modules] = await Promise.all([getT(), getIntlLocale(), getCurrentSession(ctx), setupReport(ctx), schoolModules(ctx.schoolId)]);
  const sessionId = session?.id ?? null;

  return (
    <>
      <PageHeader
        variant="hero"
        title={`${t(greetingKey(), { name: ctx.user.firstName })} 👋`}
        description={session ? `${t("dashboard.admin.session", { name: session.name })} · ${formatDayShort(new Date(), intl)}` : t("dashboard.admin.noSession")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/school-admin/attendance">
                <ClipboardCheckIcon aria-hidden />
                Today&apos;s attendance
              </Link>
            </Button>
            {modules.includes("FINANCE") ? (
              <Button asChild variant="outline">
                <Link href="/school-admin/finance/payments">
                  <WalletIcon aria-hidden />
                  Collect fee
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <SetupProgressCard report={setup} />

      <Suspense fallback={<SectionSkeleton tiles={5} />}>
        <TodaySection ctx={ctx} sessionId={sessionId} modules={modules} />
      </Suspense>

      <QuickActions
        compact
        title="Daily tasks"
        // Only what the school's plan includes.
        actions={(
          [
          { href: "/school-admin/finance/payments", label: "Collect fee", icon: WalletIcon, tone: "green" },
          { href: "/school-admin/students/new", label: "Add student", icon: UserPlusIcon, tone: "blue" },
          { href: "/school-admin/admissions/enquiries/new", label: "Add enquiry", icon: UserRoundPlusIcon, tone: "orange" },
          { href: "/school-admin/notices/new", label: "Send notice", icon: MegaphoneIcon, tone: "amber" },
          { href: "/school-admin/exams/new", label: "Create test", icon: ClipboardPlusIcon, tone: "purple" },
          { href: "/school-admin/meetings/new", label: "New meeting", icon: HandshakeIcon, tone: "cyan" },
          { href: "/school-admin/staff/new", label: "Add staff", icon: UserCogIcon, tone: "purple" },
          { href: "/school-admin/finance/expenses", label: "Add expense", icon: ReceiptTextIcon, tone: "red" },
          ] as const
        ).filter((action) => hrefAllowed(action.href, modules))}
      />

      <div className="grid gap-x-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {sessionId ? (
            <>
              <Suspense fallback={<SectionSkeleton tiles={4} chart />}>
                <AcademicSection ctx={ctx} sessionId={sessionId} />
              </Suspense>

              {modules.includes("FINANCE") ? (
                <Suspense fallback={<SectionSkeleton tiles={5} chart />}>
                  <FinanceSection ctx={ctx} sessionId={sessionId} />
                </Suspense>
              ) : null}

              {modules.includes("PAYROLL") ? (
                <Suspense fallback={<SectionSkeleton tiles={3} />}>
                  <SalariesSection ctx={ctx} />
                </Suspense>
              ) : null}

              <div className="mb-10">
                <Suspense fallback={<SectionSkeleton tiles={2} chart />}>
                  <StudentsSection ctx={ctx} sessionId={sessionId} />
                </Suspense>
              </div>
            </>
          ) : null}

          <Suspense fallback={<SectionSkeleton tiles={8} />}>
            <StaffWorkspacesSection ctx={ctx} />
          </Suspense>
        </div>

        <aside aria-label="Needs action, staff today and what is coming up" className="order-first min-w-0 xl:order-none xl:border-l xl:pl-8">
          <Suspense fallback={<SectionSkeleton tiles={1} />}>
            <NeedsActionSection ctx={ctx} sessionId={sessionId} stacked />
          </Suspense>

          <div className="mb-8">
            <Suspense fallback={<SectionSkeleton tiles={4} />}>
              <StaffSection ctx={ctx} sessionId={sessionId} />
            </Suspense>
          </div>

          <Suspense fallback={<SectionSkeleton tiles={4} />}>
            <SchoolLifeCards ctx={ctx} base="/school-admin" narrow />
          </Suspense>
        </aside>
      </div>
    </>
  );
}
