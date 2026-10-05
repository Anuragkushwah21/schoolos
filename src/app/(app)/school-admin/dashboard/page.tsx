import type { Metadata } from "next";
import { Suspense } from "react";
import {
  CalendarPlusIcon,
  ClipboardPlusIcon,
  HandshakeIcon,
  MegaphoneIcon,
  UserCogIcon,
  UserPlusIcon,
  UserRoundPlusIcon,
  WalletIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { QuickActions } from "@/components/shared/quick-actions";
import {
  AcademicSection,
  FinanceSection,
  NeedsActionSection,
  SectionSkeleton,
  StaffSection,
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
import { getIntlLocale, getT } from "@/server/i18n";

export const metadata: Metadata = { title: "School dashboard" };

/**
 * The School Admin's home, top to bottom in the order the questions come:
 * what happened today, how many students, the academic picture, staff,
 * money, what is happening soon, and what needs a decision. Quick actions sit
 * apart from the figures. Each section streams in on its own, so a slow one
 * never holds up the rest.
 */
export default async function AdminDashboardPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [t, intl, session, setup] = await Promise.all([getT(), getIntlLocale(), getCurrentSession(ctx), setupReport(ctx)]);
  const sessionId = session?.id ?? null;

  return (
    <>
      <PageHeader
        variant="hero"
        title={`${t(greetingKey(), { name: ctx.user.firstName })} 👋`}
        description={session ? `${t("dashboard.admin.session", { name: session.name })} · ${formatDayShort(new Date(), intl)}` : t("dashboard.admin.noSession")}
      />

      <SetupProgressCard report={setup} />

      <QuickActions
        title="Quick actions"
        actions={[
          { href: "/school-admin/students/new", label: "Add student", icon: UserPlusIcon, tone: "blue" },
          { href: "/school-admin/teachers", label: "Add teacher / staff", icon: UserCogIcon, tone: "purple" },
          { href: "/school-admin/exams/new", label: "Create test", icon: ClipboardPlusIcon, tone: "purple" },
          { href: "/school-admin/finance/fees", label: "Add fee", icon: WalletIcon, tone: "green" },
          { href: "/school-admin/notices/new", label: "Create notice", icon: MegaphoneIcon, tone: "amber" },
          { href: "/school-admin/events/new", label: "Create event", icon: CalendarPlusIcon, tone: "blue" },
          { href: "/school-admin/meetings/new", label: "Create meeting", icon: HandshakeIcon, tone: "cyan" },
          { href: "/school-admin/admissions/enquiries/new", label: "Add enquiry", icon: UserRoundPlusIcon, tone: "orange" },
        ]}
      />

      <Suspense fallback={<SectionSkeleton tiles={5} />}>
        <TodaySection ctx={ctx} sessionId={sessionId} />
      </Suspense>

      {sessionId ? (
        <>
          <div className="mb-10 grid gap-6 xl:grid-cols-2">
            <Suspense fallback={<SectionSkeleton tiles={2} chart />}>
              <StudentsSection ctx={ctx} sessionId={sessionId} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton tiles={4} />}>
              <StaffSection ctx={ctx} sessionId={sessionId} />
            </Suspense>
          </div>

          <Suspense fallback={<SectionSkeleton tiles={4} chart />}>
            <AcademicSection ctx={ctx} sessionId={sessionId} />
          </Suspense>

          <Suspense fallback={<SectionSkeleton tiles={5} chart />}>
            <FinanceSection ctx={ctx} sessionId={sessionId} />
          </Suspense>
        </>
      ) : null}

      <section aria-labelledby="soon" className="mb-2">
        <h2 id="soon" className="mb-3 text-lg font-bold tracking-tight">
          Happening soon
        </h2>
        <Suspense fallback={<SectionSkeleton tiles={4} />}>
          <SchoolLifeCards ctx={ctx} base="/school-admin" />
        </Suspense>
      </section>

      <Suspense fallback={<SectionSkeleton tiles={1} />}>
        <NeedsActionSection ctx={ctx} sessionId={sessionId} />
      </Suspense>
    </>
  );
}
