import { AppShell } from "@/components/shared/app-shell";
import { teacherNav } from "@/lib/nav";
import { hasAdmissionWork } from "@/server/admissions/drives";
import { requireTenant } from "@/server/auth/current-user";

/**
 * Chrome for this area. The guard here only decides whether to draw the shell;
 * layouts do not re-run on client navigation, so every page below repeats its
 * own check. "Admissions" shows only for a teacher with an admission
 * assignment — presentation only; the admission services check again.
 */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant("TEACHER");
  return (
    <AppShell user={ctx.user} nav={teacherNav({ admissions: await hasAdmissionWork(ctx) })}>
      {children}
    </AppShell>
  );
}
