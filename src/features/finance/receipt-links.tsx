import type { Route } from "next";
import Link from "next/link";
import { FileTextIcon, PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "Receipt" and "Print" for one payment, wherever payments are listed. Both
 * open the stand-alone receipt page in a new tab — the second straight into
 * the print dialog — so the list the user came from stays where it was.
 */
export function ReceiptLinks({ paymentId, receiptNo }: { paymentId: string; receiptNo: string }) {
  return (
    <span className="inline-flex gap-1">
      <Button asChild variant="ghost" size="xs">
        <Link href={`/receipts/${paymentId}` as Route} target="_blank" aria-label={`View receipt ${receiptNo}`}>
          <FileTextIcon className="size-3.5" aria-hidden />
          Receipt
        </Link>
      </Button>
      <Button asChild variant="ghost" size="xs">
        <Link href={`/receipts/${paymentId}?print=1` as Route} target="_blank" aria-label={`Print receipt ${receiptNo}`}>
          <PrinterIcon className="size-3.5" aria-hidden />
          Print
        </Link>
      </Button>
    </span>
  );
}
