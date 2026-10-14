import type { Metadata } from "next";
import { cache } from "react";

import { PrintToolbar } from "@/components/shared/print-toolbar";
import { ReportCard } from "@/features/exams/report-card";
import { param } from "@/lib/search-params";
import { DemoWatermark } from "@/components/shared/demo-watermark";
import { requireTenant } from "@/server/auth/current-user";
import { getReportCard } from "@/server/exams/results";
import { orNotFound } from "@/server/page-helpers";
import { photoUrlFor } from "@/server/people/photos";

/**
 * A report card on its own page, with nothing else to print. The School Admin
 * may open any (drafts are marked as such); a parent or student only a
 * published one of their own — `getReportCard` decides.
 */

const load = cache(async (examId: string, studentId: string) => {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL", "PARENT", "STUDENT");
  return { ctx, card: await orNotFound(getReportCard(ctx, examId, studentId)) };
});

export async function generateMetadata(props: PageProps<"/report-cards/[examId]/[studentId]">): Promise<Metadata> {
  const { examId, studentId } = await props.params;
  const { card } = await load(examId, studentId);
  return { title: { absolute: `Report card · ${card.student.name} · ${card.exam.name}` } };
}

const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  html, body { background: #fff !important; }
  .no-print, [data-sonner-toaster] { display: none !important; }
  .print-page { padding: 0 !important; background: #fff !important; min-height: 0 !important; }
  .report-sheet { box-shadow: none !important; --tw-ring-shadow: 0 0 #0000 !important; max-width: none !important; padding: 0 !important; }
  .report-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-table thead { display: table-header-group; }
  .report-table tr, .report-sheet footer, .report-sheet section, .keep-together { break-inside: avoid; }
  .report-sheet header, .report-sheet h2 { break-after: avoid; }
}
`;

export default async function ReportCardPage(props: PageProps<"/report-cards/[examId]/[studentId]">) {
  const { examId, studentId } = await props.params;
  const search = await props.searchParams;
  const { ctx, card } = await load(examId, studentId);
  // The photo only if this viewer may see it (the same check as anywhere else); none otherwise.
  const photoUrl = await photoUrlFor(ctx, { type: "STUDENT", id: studentId }).catch(() => null);

  const back =
    ctx.user.role === "SCHOOL_ADMIN" || ctx.user.role === "PRINCIPAL"
      ? { href: `/school-admin/students/${studentId}?tab=academics`, label: "Student" }
      : ctx.user.role === "PARENT"
        ? { href: `/parent/children/${studentId}/results`, label: "Results" }
        : { href: "/student/results", label: "My results" };

  return (
    <main className="print-page min-h-screen bg-neutral-100 px-4 py-6 text-neutral-900 sm:py-10">
      {ctx.user.isDemo ? <DemoWatermark what="report card" /> : null}
      <style>{PRINT_CSS}</style>
      <PrintToolbar backHref={back.href} backLabel={back.label} autoPrint={param(search.print) === "1"} />
      <ReportCard card={card} photoUrl={photoUrl} />
    </main>
  );
}
