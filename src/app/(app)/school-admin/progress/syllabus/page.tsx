import type { Metadata } from "next";
import { ListTreeIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { NoSessionNotice } from "@/components/shared/no-session-notice";
import { PageHeader } from "@/components/shared/page-header";
import { DeleteSyllabusItemButton, SyllabusItemForm } from "@/features/academics/progress-forms";
import { SectionCard } from "@/features/academics/progress-views";
import { toDateInput } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getSyllabus } from "@/server/academics/syllabus";
import { getCurrentSession, listClasses, listSubjects } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Syllabus" };

/**
 * The school's own syllabus per class and subject, this session: units,
 * chapters and topics. What is expected to be taught — teachers record what
 * they taught in each class record. School leaders edit it.
 */
export default async function SyllabusPage(props: PageProps<"/school-admin/progress/syllabus">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const session = await getCurrentSession(ctx);
  if (!session) return <NoSessionNotice title="Syllabus" back={{ href: "/school-admin/progress", label: "Academic progress" }} />;
  const search = await props.searchParams;
  const [classes, subjects] = await Promise.all([listClasses(ctx, { activeOnly: true }), listSubjects(ctx, { activeOnly: true })]);
  const classId = classes.find((row) => row.id === param(search.class))?.id ?? classes[0]?.id ?? "";
  const subjectId = subjects.find((row) => row.id === param(search.subject))?.id ?? subjects[0]?.id ?? "";
  const units = classId && subjectId ? await getSyllabus(ctx, { classId, subjectId }) : [];

  return (
    <>
      <PageHeader icon={ListTreeIcon} tone="blue" back={{ href: "/school-admin/progress", label: "Academic progress" }} title="Syllabus" description={`Units, chapters and topics for ${session.name}. Coverage is measured against these; without them a class shows “Syllabus not configured”.`} />
      <FilterBar
        action="/school-admin/progress/syllabus"
        selects={[
          { name: "class", label: "Class", defaultValue: classId, options: classes.map((row) => ({ value: row.id, label: row.name })) },
          { name: "subject", label: "Subject", defaultValue: subjectId, options: subjects.map((row) => ({ value: row.id, label: row.name })) },
        ]}
      />
      {!classId || !subjectId ? (
        <EmptyState title="Add classes and subjects first">The syllabus is set per class and subject.</EmptyState>
      ) : (
        <div className="mt-6 flex max-w-4xl flex-col gap-6">
          {units.length ? null : <p className="text-muted-foreground text-sm">No units yet for this class and subject.</p>}
          {units.map((unit, index) => (
            <SectionCard key={unit.id} title={`${index + 1}. ${unit.title}`} description={`${unit.chapters.length} chapter(s) · ${unit.chapters.reduce((sum, chapter) => sum + chapter.topics.length, 0)} topic(s)`}>
              <div className="flex flex-col gap-4">
                <details className="rounded-lg border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Edit unit</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <SyllabusItemForm classId={classId} subjectId={subjectId} level="UNIT" parentId={null} item={{ id: unit.id, title: unit.title, plannedFrom: unit.plannedFrom ? toDateInput(unit.plannedFrom) : "", plannedTo: unit.plannedTo ? toDateInput(unit.plannedTo) : "" }} />
                    <div>
                      <DeleteSyllabusItemButton id={unit.id} title={unit.title} />
                    </div>
                  </div>
                </details>
                {unit.chapters.map((chapter) => (
                  <div key={chapter.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{chapter.title}</p>
                      <DeleteSyllabusItemButton id={chapter.id} title={chapter.title} />
                    </div>
                    <ul className="mt-2 flex flex-col gap-1 text-sm">
                      {chapter.topics.map((topic) => (
                        <li key={topic.id} className="flex flex-wrap items-center justify-between gap-2">
                          <details className="flex-1">
                            <summary className="cursor-pointer">{topic.title}</summary>
                            <div className="mt-2">
                              <SyllabusItemForm compact classId={classId} subjectId={subjectId} level="TOPIC" parentId={chapter.id} item={{ id: topic.id, title: topic.title }} />
                            </div>
                          </details>
                          <DeleteSyllabusItemButton id={topic.id} title={topic.title} />
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex flex-col gap-2">
                      <SyllabusItemForm compact classId={classId} subjectId={subjectId} level="TOPIC" parentId={chapter.id} />
                      <details className="text-xs">
                        <summary className="text-muted-foreground cursor-pointer">Rename chapter</summary>
                        <div className="mt-2">
                          <SyllabusItemForm compact classId={classId} subjectId={subjectId} level="CHAPTER" parentId={unit.id} item={{ id: chapter.id, title: chapter.title }} />
                        </div>
                      </details>
                    </div>
                  </div>
                ))}
                <SyllabusItemForm compact classId={classId} subjectId={subjectId} level="CHAPTER" parentId={unit.id} />
              </div>
            </SectionCard>
          ))}
          <SectionCard title="Add a unit">
            <SyllabusItemForm classId={classId} subjectId={subjectId} level="UNIT" parentId={null} />
          </SectionCard>
        </div>
      )}
    </>
  );
}
