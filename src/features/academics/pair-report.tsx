import type { Route } from "next";

import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/dates";
import type { PairProgress, examReadiness, unitReport } from "@/server/academics/progress";

import { LeaderReviewForm, MarkUnitReadyForm, RespondReviewForm, UpdateReviewForm } from "./progress-forms";
import { AssessmentTable, MeasuresCard, Percent, ReviewSummary, SectionCard, UnitRow } from "./progress-views";

type Mode = { role: "leader" | "teacher"; base: string; lessons?: Array<{ value: string; label: string }>; tests?: Array<{ value: string; label: string }> };
const ATTENDANCE: Record<string, string> = { PRESENT: "present", ABSENT: "absent", LATE: "late", HALF_DAY: "half day", ON_LEAVE: "on leave", LEAVE: "on leave" };

/** One class and subject: the five measures, units, lessons with no record, tests and reviews. */
export function PairOverview({ progress, mode }: { progress: PairProgress; mode: Mode }) {
  const query = "section=" + progress.pair.sectionId + "&subject=" + progress.pair.subjectId;
  return (
    <div className="flex flex-col gap-6">
      <MeasuresCard syllabus={progress.syllabus} homework={progress.homework} assessments={progress.assessments} />

      <SectionCard title="Units" description={progress.syllabus.configured ? "Topics recorded as taught in lessons, against the class's syllabus." : "Syllabus not configured — a school leader adds units, chapters and topics under Syllabus."}>
        {progress.syllabus.units.length ? (
          <ul className="divide-y">
            {progress.syllabus.units.map((unit) => (
              <UnitRow key={unit.id} unit={unit} href={(mode.base + "/class?" + query + "&unit=" + unit.id) as Route} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Syllabus not configured.</p>
        )}
      </SectionCard>

      <SectionCard title="Lessons in the last 30 days" description="From the timetable and the class records. A period with no record is shown as “lesson record missing” — not as a class that did not happen. Attendance and the register are shown beside it as separate evidence.">
        <p className="mb-3 text-sm">{`Scheduled ${progress.lessons.scheduled} · recorded as taught ${progress.lessons.completed} (${progress.lessons.withPartialTopics} with a topic partly covered) · recorded as not conducted ${progress.lessons.notConducted} · cancelled ${progress.lessons.cancelled} · lesson record missing ${progress.lessons.missingRecords.length}`}</p>
        {progress.lessons.missingRecords.length ? (
          <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
            {progress.lessons.missingRecords.slice(0, 20).map((row) => (
              <li key={`${row.slotId}-${row.date.getTime()}`}>{`${formatDate(row.date)} · ${row.teacher} · teacher attendance: ${row.teacherAttendance ? (ATTENDANCE[row.teacherAttendance] ?? row.teacherAttendance.toLowerCase()) : "not marked"} · class register: ${row.registerSubmitted ? "submitted" : "not submitted"}`}</li>
            ))}
          </ul>
        ) : null}
      </SectionCard>

      <SectionCard title="Tests" description={`Tests with submitted marks. Below ${progress.threshold}% (the school's review threshold) is flagged for a look.`}>
        <AssessmentTable stats={progress.assessments} threshold={progress.threshold} />
        {mode.role === "leader"
          ? progress.assessments
              .filter((stat) => stat.belowThreshold && !stat.reviewId)
              .map((stat) => (
                <details key={stat.id} className="mt-3 rounded-lg border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">{`Review ${stat.name} (${stat.averagePercent}%, ${stat.sat} students)`}</summary>
                  <div className="mt-2">
                    <LeaderReviewForm sectionId={progress.pair.sectionId} subjectId={progress.pair.subjectId} assessmentId={stat.id} defaultAction="REVISION_RECOMMENDED" />
                  </div>
                </details>
              ))
          : null}
      </SectionCard>

      <ReviewsCard progress={progress} mode={mode} />
    </div>
  );
}

function ReviewsCard({ progress, mode, onlyIds }: { progress: PairProgress; mode: Mode; onlyIds?: string[] }) {
  const reviews = onlyIds ? progress.reviews.filter((row) => onlyIds.includes(row.id)) : progress.reviews;
  return (
    <SectionCard title="Reviews and revision" description="Notes, update requests and revision for this class and subject. Every change is in the audit log.">
      {reviews.length ? (
        <ul className="divide-y">
          {reviews.map((review) => (
            <li key={review.id} className="flex flex-col gap-2 py-3">
              <ReviewSummary review={review} />
              {review.status !== "RESOLVED" ? (
                <details className="text-sm">
                  <summary className="text-primary cursor-pointer">{mode.role === "leader" ? "Update this review" : "Reply"}</summary>
                  <div className="mt-2">{mode.role === "leader" ? <UpdateReviewForm reviewId={review.id} readyUnit={review.kind === "UNIT_READY"} /> : <RespondReviewForm reviewId={review.id} lessons={mode.lessons ?? []} tests={mode.tests ?? []} />}</div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No reviews yet.</p>
      )}
      {mode.role === "leader" ? (
        <details className="mt-3 rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Add a note or request</summary>
          <div className="mt-2">
            <LeaderReviewForm sectionId={progress.pair.sectionId} subjectId={progress.pair.subjectId} />
          </div>
        </details>
      ) : null}
    </SectionCard>
  );
}

/** One unit's report: what was expected and taught, homework, tests, gaps, pending work and reviews. */
export function UnitReportView({ report, progress, mode }: { report: Awaited<ReturnType<typeof unitReport>>; progress: PairProgress; mode: Mode }) {
  const { unit } = report;
  const canMarkReady = mode.role === "teacher" && (!unit.readyReview || unit.readyReview.status === "RESOLVED");
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{`${report.school} · ${report.session} · ${report.section} · ${report.subject}${report.teachers.length ? ` · ${report.teachers.join(", ")}` : ""}`}</p>
      <MeasuresCard syllabus={{ configured: unit.expected > 0, percent: unit.percent, covered: unit.covered, expected: unit.expected }} homework={unit.homework} assessments={unit.assessments} />

      <SectionCard title="Topics" description={`${unit.covered} of ${unit.expected} recorded as taught${unit.partial ? `, ${unit.partial} partly` : ""}. Taught in ${report.lessonsTeachingUnit} recorded lesson(s).${unit.behind ? " The planned end has passed with topics left." : ""}`}>
        {unit.topics.length ? (
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {unit.topics.map((topic) => (
              <li key={topic.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={topic.coverage ?? "NONE"} label={topic.coverage === "COVERED" ? "Taught" : topic.coverage === "PARTIAL" ? "Partly" : "Not yet"} tone={topic.coverage === "COVERED" ? "positive" : topic.coverage === "PARTIAL" ? "info" : "neutral"} />
                <span>{topic.title}</span>
                <span className="text-muted-foreground text-xs">{topic.chapter}{topic.lastTaughtOn ? ` · ${formatDate(topic.lastTaughtOn)}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">This unit has no topics yet, so coverage cannot be measured.</p>
        )}
      </SectionCard>

      <SectionCard title="Homework for this unit" description="Homework linked to the unit or its chapters and topics.">
        <p className="text-sm">{`Set ${unit.homework.assigned} · due ${unit.homework.due} · submitted on time ${unit.homework.submitted} · late ${unit.homework.late} · missing ${unit.homework.missing} · not yet checked ${unit.homework.unchecked}`}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Submitted: <Percent value={unit.homework.submissionRate} empty="—" /> · checked by teacher: <Percent value={unit.homework.reviewRate} empty="—" />
        </p>
      </SectionCard>

      <SectionCard title="Tests for this unit">
        <AssessmentTable stats={unit.assessments} threshold={report.threshold} />
      </SectionCard>

      <SectionCard title="Learning gaps and pending work" description="Places to look at — not a judgement of anyone.">
        {report.gaps.length || report.pending.length ? (
          <ul className="list-disc pl-5 text-sm">
            {report.gaps.map((gap) => (
              <li key={gap.topic.id}>{`${gap.topic.title}: ${gap.reasons.join("; ")}`}</li>
            ))}
            {report.pending.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Nothing pending.</p>
        )}
      </SectionCard>

      {canMarkReady ? (
        <SectionCard title="Ready for review?" description="When the unit's topics are taught, send it to your school leaders. They see the same report.">
          <MarkUnitReadyForm sectionId={progress.pair.sectionId} subjectId={progress.pair.subjectId} unitId={unit.id} />
        </SectionCard>
      ) : null}

      <ReviewsCard progress={progress} mode={mode} onlyIds={report.reviews.map((row) => row.id)} />
    </div>
  );
}

/** Before exams: the evidence per subject. It never declares a class ready — staff decide. */
export function ReadinessView({ data }: { data: Awaited<ReturnType<typeof examReadiness>> }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{`Built from lessons, homework, tests and reviews on ${formatDate(data.generatedAt)}. This shows the evidence; whether the class is ready is for the teachers and school leaders to decide.`}</p>
      {data.subjects.map((subject) => (
        <SectionCard key={subject.pair.subjectId} title={subject.subject} description={subject.teachers.join(", ")}>
          <div className="flex flex-col gap-4">
            <MeasuresCard syllabus={subject.syllabus} homework={subject.homework} assessments={subject.assessments} />
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">Units completed</p>
                {subject.unitsCompleted.length ? <ul className="list-disc pl-5 text-sm">{subject.unitsCompleted.map((title) => <li key={title}>{title}</li>)}</ul> : <p className="text-muted-foreground text-sm">{subject.syllabus.configured ? "None yet." : "Syllabus not configured."}</p>}
              </div>
              <div>
                <p className="text-sm font-semibold">Units still pending</p>
                {subject.unitsPending.length ? (
                  <ul className="list-disc pl-5 text-sm">
                    {subject.unitsPending.map((unit) => (
                      <li key={unit.title}>{`${unit.title}${unit.behind ? " (behind plan)" : ""}${unit.pendingTopics.length ? `: ${unit.pendingTopics.join(", ")}` : " — no topics set up"}`}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">None.</p>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold">Needs more teaching</p>
              {subject.needsTeaching.length ? <ul className="list-disc pl-5 text-sm">{subject.needsTeaching.map((row) => <li key={`${row.unit}-${row.topic}-${row.reason}`}>{`${row.unit} › ${row.topic}: ${row.reason}`}</li>)}</ul> : <p className="text-muted-foreground text-sm">Nothing flagged from the records.</p>}
            </div>
            <div>
              <p className="text-sm font-semibold">Revision</p>
              {subject.revisions.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {subject.revisions.map((row) => (
                    <li key={row.id}>
                      <ReviewSummary review={row} />
                      <p className="text-muted-foreground text-xs">{`Original test average: ${row.originalAverage ?? "—"}% · follow-up test average: ${row.followUpAverage === null ? "no follow-up marks yet" : `${row.followUpAverage}%`}`}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No revision recorded.</p>
              )}
            </div>
            <AssessmentTable stats={subject.assessments} threshold={subject.threshold} />
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
