import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { OUTCOME_LABEL, passMarkFor } from "@/lib/grades";
import type { ReportCard as ReportCardData } from "@/server/exams/results";

/**
 * The printed report card. Black on white whatever the theme; the school's
 * colour is used only for its name and rules, as on the fee receipt.
 */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-neutral-500">{label}</dt>
      <dd className="min-w-0 font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export function ReportCard({ card }: { card: ReportCardData }) {
  const { school, exam, student, subjects } = card;
  const accent = /^#[0-9a-f]{6}$/i.test(school.primaryColor) ? school.primaryColor : "#1e40af";

  return (
    <article
      className="report-sheet mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-10"
      style={{ colorScheme: "light" }}
      aria-label={`Report card: ${student.name}, ${exam.name}`}
    >
      <header className="flex items-start gap-4 border-b-2 pb-4" style={{ borderColor: accent }}>
        {school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a school-supplied https link
          <img src={school.logoUrl} alt={`${school.name} logo`} className="size-16 shrink-0 object-contain" />
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-tight font-bold" style={{ color: accent }}>
            {school.name}
          </h1>
          {school.headerNote ? <p className="mt-0.5 font-medium">{school.headerNote}</p> : null}
          {school.address ? <p className="text-neutral-600">{school.address}</p> : null}
          <p className="text-neutral-600">
            {[school.phone ? `Phone: ${school.phone}` : null, school.email ? `Email: ${school.email}` : null].filter(Boolean).join(" · ")}
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

      <h2 className="my-4 text-center text-lg font-bold tracking-wide uppercase">
        Report card · {exam.name}
      </h2>
      {exam.status !== "PUBLISHED" ? (
        <p className="mb-3 text-center text-xs font-semibold tracking-wide text-red-700 uppercase">
          Draft — results not yet published
        </p>
      ) : null}

      <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <dl className="flex flex-col gap-1">
          <Row label="Student" value={student.name} />
          <Row label="Admission no." value={student.admissionNumber} />
          <Row label="Date of birth" value={student.dateOfBirth ? formatDate(student.dateOfBirth) : null} />
          {student.guardian ? <Row label={humanize(student.guardian.relationship)} value={student.guardian.name} /> : null}
        </dl>
        <dl className="flex flex-col gap-1">
          <Row label="Class" value={student.className} />
          <Row label="Section" value={student.sectionName} />
          <Row label="Roll no." value={student.rollNumber} />
          <Row label="Session" value={exam.session} />
          <Row label="Exam dates" value={`${formatDate(exam.startDate)} – ${formatDate(exam.endDate)}`} />
        </dl>
      </div>

      <table className="report-table mt-5 w-full border-collapse">
        <thead>
          <tr className="border-y border-neutral-300 bg-neutral-50 text-left">
            <th className="px-2 py-1.5 font-semibold">Subject</th>
            <th className="px-2 py-1.5 text-right font-semibold">Max</th>
            <th className="px-2 py-1.5 text-right font-semibold">Pass</th>
            <th className="px-2 py-1.5 text-right font-semibold">Obtained</th>
            <th className="px-2 py-1.5 font-semibold">Grade</th>
            <th className="px-2 py-1.5 font-semibold">Remark</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((row) => (
            <tr key={row.assessmentId} className="border-b border-neutral-200">
              <td className="px-2 py-1.5">{row.subject}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{row.maxMarks}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{passMarkFor(row.maxMarks, row.passMarks)}</td>
              <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                {row.absent ? "AB" : row.marksObtained ?? "—"}
                {row.outcome === "FAIL" ? <span className="text-red-700"> *</span> : null}
              </td>
              <td className="px-2 py-1.5">{row.grade ?? "—"}</td>
              <td className="px-2 py-1.5 text-neutral-700">{row.remark ?? ""}</td>
            </tr>
          ))}
          <tr className="border-b-2 border-neutral-400 font-semibold">
            <td className="px-2 py-1.5">Total</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{card.maxTotal}</td>
            <td />
            <td className="px-2 py-1.5 text-right tabular-nums">{card.total}</td>
            <td className="px-2 py-1.5">{card.grade ?? "—"}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-neutral-300 p-3">
          <p className="text-neutral-500">Percentage</p>
          <p className="text-lg font-bold tabular-nums">{card.percent === null ? "—" : `${card.percent}%`}</p>
        </div>
        <div className="rounded border border-neutral-300 p-3">
          <p className="text-neutral-500">Result</p>
          <p className="text-lg font-bold" style={{ color: card.outcome === "PASS" ? accent : undefined }}>
            {OUTCOME_LABEL[card.outcome]}
          </p>
        </div>
        <div className="rounded border border-neutral-300 p-3">
          <p className="text-neutral-500">Attendance (session to date)</p>
          <p className="text-lg font-bold tabular-nums">
            {card.attendance.share === null
              ? "—"
              : `${Math.round(card.attendance.share * 100)}% · ${card.attendance.counts.PRESENT + card.attendance.counts.LATE}/${card.attendance.counts.total} days`}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        AB = absent. * = below the pass mark. Grades: A1 91–100, A2 81–90, B1 71–80, B2 61–70, C1 51–60, C2 41–50, D 33–40, E below 33.
      </p>

      <footer className="mt-14 grid grid-cols-3 gap-6 text-center text-neutral-600">
        {["Class teacher", "Principal", "Parent / guardian"].map((label) => (
          <div key={label}>
            <p className="mb-1 min-h-5 font-medium text-neutral-800">{label === "Class teacher" ? card.classTeacher ?? "" : ""}</p>
            <div className="mb-1 h-px bg-neutral-400" />
            <p>{label}</p>
          </div>
        ))}
      </footer>
    </article>
  );
}
