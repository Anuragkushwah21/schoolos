import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Receipt } from "@/server/finance/receipts";

import { rupees, rupeesInWords } from "./money";

/**
 * The printed fee receipt.
 *
 * Plain black-on-white whatever the app's theme, because it is going to paper;
 * the school's own colour is used only for its name and the rules. Two sizes:
 * `a4` for a full-page office copy, `slip` for the half-page fee slip most
 * schools hand across the counter.
 */

export type ReceiptFormat = "a4" | "slip";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  CARD: "Card",
  OTHER: "Other",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 font-medium break-words">{value ?? "—"}</dd>
    </div>
  );
}

export function FeeReceipt({ receipt, format }: { receipt: Receipt; format: ReceiptFormat }) {
  const { school, payment, student, guardian, fees, session } = receipt;
  const slip = format === "slip";
  const accent = /^#[0-9a-f]{6}$/i.test(school.primaryColor) ? school.primaryColor : "#1e40af";

  return (
    <article
      className={cn(
        "receipt-sheet mx-auto bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200",
        slip ? "w-full max-w-[148mm] p-5 text-[11px]" : "w-full max-w-[210mm] p-8 text-[13px] sm:p-10",
      )}
      style={{ colorScheme: "light" }}
      aria-label={`Fee receipt ${payment.receiptNo}`}
    >
      {/* ---------------- school header ---------------- */}
      <header className="flex items-start gap-4 border-b-2 pb-4" style={{ borderColor: accent }}>
        {school.logoUrl ? (
          // An external https link the school set itself; next/image would need
          // every school's host whitelisted.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={school.logoUrl}
            alt={`${school.name} logo`}
            className={cn("shrink-0 object-contain", slip ? "size-12" : "size-16")}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className={cn("leading-tight font-bold", slip ? "text-base" : "text-2xl")} style={{ color: accent }}>
            {school.name}
          </h1>
          {school.headerNote ? <p className="mt-0.5 font-medium">{school.headerNote}</p> : null}
          {school.address ? <p className="mt-0.5 text-neutral-600">{school.address}</p> : null}
          <p className="text-neutral-600">
            {[school.phone ? `Phone: ${school.phone}` : null, school.email ? `Email: ${school.email}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {school.affiliation || school.udiseCode ? (
            <p className="text-neutral-600">
              {[school.affiliation ? `Affiliation: ${school.affiliation}` : null, school.udiseCode ? `UDISE: ${school.udiseCode}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </header>

      <h2 className={cn("my-4 text-center font-bold tracking-wide uppercase", slip ? "text-sm" : "text-lg")}>
        Fee receipt
      </h2>

      {/* ---------------- receipt, student, guardian ---------------- */}
      <div className={cn("grid gap-x-8 gap-y-1", slip ? "grid-cols-1" : "sm:grid-cols-2")}>
        <dl className="flex flex-col gap-1">
          <Field label="Receipt no." value={<span className="font-mono">{payment.receiptNo}</span>} />
          <Field label="Payment date" value={formatDate(payment.paidOn)} />
          <Field label="Session" value={session.name} />
          <Field label="Payment mode" value={METHOD_LABEL[payment.method] ?? humanize(payment.method)} />
          {payment.referenceNo ? <Field label="Reference no." value={payment.referenceNo} /> : null}
        </dl>
        <dl className="flex flex-col gap-1">
          <Field label="Student" value={student.name} />
          <Field label="Admission no." value={student.admissionNumber} />
          <Field label="Class" value={student.className} />
          <Field label="Section" value={student.sectionName} />
          <Field label="Roll no." value={student.rollNumber} />
        </dl>
      </div>
      {guardian ? (
        <dl className={cn("mt-1 grid gap-x-8 gap-y-1", slip ? "grid-cols-1" : "sm:grid-cols-2")}>
          <Field label={`${humanize(guardian.relationship)}`} value={guardian.name} />
          <Field label="Contact" value={guardian.phone} />
        </dl>
      ) : null}

      {/* ---------------- fee structure ---------------- */}
      <table className="receipt-table mt-5 w-full border-collapse">
        <thead>
          <tr className="border-y border-neutral-300 bg-neutral-50 text-left">
            <th className="px-2 py-1.5 font-semibold">Fee structure ({session.name})</th>
            <th className="px-2 py-1.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {fees.breakdown.length ? (
            fees.breakdown.map((row) => (
              <tr key={row.head} className="border-b border-neutral-200">
                <td className="px-2 py-1.5">{row.head}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rupees(row.amountMinor)}</td>
              </tr>
            ))
          ) : (
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500" colSpan={2}>
                No fee heads charged this session.
              </td>
            </tr>
          )}
          <tr className="border-b-2 border-neutral-400 font-semibold">
            <td className="px-2 py-1.5">Total fee</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{rupees(fees.totalMinor)}</td>
          </tr>
        </tbody>
      </table>

      {/* ---------------- this payment ---------------- */}
      <table className="receipt-table mt-3 ml-auto w-full border-collapse sm:w-2/3">
        <tbody>
          <tr>
            <td className="px-2 py-1">Previously paid</td>
            <td className="px-2 py-1 text-right tabular-nums">{rupees(fees.previouslyPaidMinor)}</td>
          </tr>
          <tr className="border-y border-neutral-300 font-bold" style={{ color: accent }}>
            <td className="px-2 py-1.5">Current payment</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{rupees(fees.currentMinor)}</td>
          </tr>
          <tr className="font-semibold">
            <td className="px-2 py-1">Remaining balance</td>
            <td className="px-2 py-1 text-right tabular-nums">{rupees(fees.remainingMinor)}</td>
          </tr>
          {fees.excessMinor ? (
            <tr>
              <td className="px-2 py-1">Paid in excess</td>
              <td className="px-2 py-1 text-right tabular-nums">{rupees(fees.excessMinor)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <p className="mt-3 italic">
        Amount received: <span className="font-medium not-italic">{rupeesInWords(fees.currentMinor)}</span>
      </p>
      {payment.notes ? <p className="mt-1 text-neutral-600">Note: {payment.notes}</p> : null}

      {/* ---------------- footer ---------------- */}
      <footer className={cn("flex items-end justify-between gap-6", slip ? "mt-8" : "mt-14")}>
        <div className="text-neutral-500">
          {school.footerNote ? <p className="mb-1 text-neutral-700">{school.footerNote}</p> : null}
          <p>Computer-generated receipt{payment.recordedBy ? ` · Recorded by ${payment.recordedBy}` : ""}.</p>
        </div>
        <div className="shrink-0 text-center">
          <div className="mb-1 h-px w-40 bg-neutral-400" />
          <p className="text-neutral-600">Authorised signatory</p>
        </div>
      </footer>
    </article>
  );
}
