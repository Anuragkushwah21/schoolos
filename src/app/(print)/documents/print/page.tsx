import type { Metadata, Route } from "next";
import Link from "next/link";

import { PrintToolbar } from "@/components/shared/print-toolbar";
import { CardSheetPage, DOCUMENT_PRINT_CSS, DocumentSheet, cardSheetPages } from "@/features/documents/document-view";
import { DOCUMENTS } from "@/lib/documents";
import { param } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { requireTenant } from "@/server/auth/current-user";
import { documentsForPrint, listDocuments } from "@/server/documents/service";
import { orHidden } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Print documents" };

/**
 * One document, or a whole batch, ready to print — or save as one PDF with
 * the browser's "Save as PDF". Certificates, letters, TCs and marksheets one
 * per A4 page, each in its own layout. ID cards at their real size (85.60 ×
 * 53.98 mm), ten to an A4 page: fronts then mirrored backs for double-sided
 * printing, or front and back side by side. Every document passes the same
 * checks as on screen.
 */
export default async function PrintDocumentsPage(props: PageProps<"/documents/print">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const search = await props.searchParams;
  const batch = param(search.batch);
  const idsParam = param(search.ids) ?? "";
  const layout = param(search.layout) === "pairs" ? "pairs" : "duplex";
  const ids = batch ? (await listDocuments(ctx, { batchKey: batch })).map((row) => row.id) : idsParam.split(",").filter(Boolean);
  const docs = await orHidden(documentsForPrint(ctx, ids));
  const meta = (doc: (typeof docs)[number]) => ({ id: doc.id, number: doc.number, issuedOn: doc.issuedOn, status: doc.status, signatureSrc: doc.hasSignatureImage ? `/api/v1/documents/${doc.id}/signature` : null });
  const cards = docs.filter((doc) => DOCUMENTS[doc.type].card);
  const sheets = docs.filter((doc) => !DOCUMENTS[doc.type].card);
  const pages = cardSheetPages(
    cards.map((doc) => ({ content: doc.content, meta: meta(doc) })),
    layout,
  );
  const here = (next: "duplex" | "pairs") => ("/documents/print?" + (batch ? "batch=" + batch : "ids=" + idsParam) + "&layout=" + next) as Route;

  return (
    <main className="print-page flex min-h-screen flex-col gap-6 overflow-x-auto bg-neutral-100 px-4 py-6 text-neutral-900 sm:py-10">
      <style>{DOCUMENT_PRINT_CSS}</style>
      <PrintToolbar backHref="/school-admin/documents" backLabel="Documents" autoPrint={param(search.print) === "1"} />
      <div className="no-print mx-auto flex w-full max-w-[210mm] flex-col gap-3 text-sm text-neutral-600">
        <p>{`Documents: ${docs.length}. Print, or choose “Save as PDF” as the printer to get one PDF. Print at 100 % (no “fit to page”) so sizes stay exact.`}</p>
        {cards.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-neutral-800">ID card sheet:</span>
            {(
              [
                { key: "duplex", label: "Fronts, then backs (double-sided)" },
                { key: "pairs", label: "Front | back side by side" },
              ] as const
            ).map((option) => (
              <Link key={option.key} href={here(option.key)} className={cn("rounded-full border px-3 py-1", layout === option.key ? "border-indigo-700 bg-indigo-700 text-white" : "bg-white hover:bg-neutral-50")}>
                {option.label}
              </Link>
            ))}
            <span className="text-xs">{layout === "duplex" ? "Ten cards a page at 85.60 × 53.98 mm. Print double-sided, flip on the long edge; cut on the dashed lines." : "Five cards a page. Cut each pair, fold and laminate back to back."}</span>
          </div>
        ) : null}
      </div>
      {pages.map((page, index) => (
        <CardSheetPage key={index} slots={page.slots} label={`${page.label} · page ${index + 1} of ${pages.length}`} />
      ))}
      {sheets.map((doc) => (
        <DocumentSheet key={doc.id} content={doc.content} meta={meta(doc)} type={doc.type} />
      ))}
    </main>
  );
}
