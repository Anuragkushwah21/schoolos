import type { Metadata } from "next";
import { cache } from "react";

import { FeeReceipt, type ReceiptFormat } from "@/features/finance/receipt";
import { ReceiptToolbar } from "@/features/finance/receipt-toolbar";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getReceipt } from "@/server/finance/receipts";
import { orNotFound } from "@/server/page-helpers";

/**
 * A fee receipt on its own page: no sidebar, no header, nothing but the
 * receipt, so the browser's print (or "Save as PDF") produces a clean copy.
 *
 * Outside the role areas on purpose, because three roles open it. `getReceipt`
 * decides who may see which payment; the school on the receipt is always the
 * session's own.
 *
 * `?format=slip` gives the compact half-page slip; `?print=1` opens the print
 * dialog as soon as the page loads (the "Print" action in payment history).
 */

const loadReceipt = cache(async (paymentId: string) => {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PARENT", "STUDENT");
  return { ctx, receipt: await orNotFound(getReceipt(ctx, paymentId)) };
});

export async function generateMetadata(props: PageProps<"/receipts/[paymentId]">): Promise<Metadata> {
  const { paymentId } = await props.params;
  const { receipt } = await loadReceipt(paymentId);
  // The title becomes the default file name when saving as PDF.
  return { title: { absolute: `Fee receipt ${receipt.payment.receiptNo} · ${receipt.student.name}` } };
}

const PRINT_CSS = (format: ReceiptFormat) => `
@page { size: ${format === "slip" ? "A5" : "A4"}; margin: ${format === "slip" ? "8mm" : "12mm"}; }
@media print {
  html, body { background: #fff !important; }
  .no-print, [data-sonner-toaster] { display: none !important; }
  .receipt-page { padding: 0 !important; background: #fff !important; min-height: 0 !important; }
  .receipt-sheet { box-shadow: none !important; --tw-ring-shadow: 0 0 #0000 !important; max-width: none !important; width: 100% !important; padding: 0 !important; }
  .receipt-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt-table tr, .receipt-sheet footer { break-inside: avoid; }
}
`;

export default async function ReceiptPage(props: PageProps<"/receipts/[paymentId]">) {
  const { paymentId } = await props.params;
  const search = await props.searchParams;
  const { ctx, receipt } = await loadReceipt(paymentId);

  const format: ReceiptFormat = param(search.format) === "slip" ? "slip" : "a4";
  const back =
    ctx.user.role === "SCHOOL_ADMIN"
      ? { href: `/school-admin/finance/payments?student=${receipt.payment.studentId}`, label: "Payments" }
      : ctx.user.role === "PARENT"
        ? { href: `/parent/children/${receipt.payment.studentId}/fees`, label: "Fees" }
        : { href: "/student/dashboard", label: "Dashboard" };

  return (
    <main className="receipt-page min-h-screen bg-neutral-100 px-4 py-6 text-neutral-900 sm:py-10">
      <style>{PRINT_CSS(format)}</style>
      <ReceiptToolbar
        backHref={back.href}
        backLabel={back.label}
        format={format}
        paymentId={receipt.payment.id}
        autoPrint={param(search.print) === "1"}
      />
      <FeeReceipt receipt={receipt} format={format} />
    </main>
  );
}
