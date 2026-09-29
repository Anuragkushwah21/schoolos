import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SetupNotice } from "@/components/shared/setup-notice";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ClassTeacherControl } from "@/features/school/academics-forms";
import { fullName } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getCurrentSession, listSections } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Class teachers" };

/**
 * Academics → Teacher assignments → Class teachers.
 *
 * One row per section of the current session: who leads it, and the controls
 * to assign, change or remove. A class teacher is separate from the subject
 * teachers of the same section — those are set on each teacher's own page.
 */
export default async function ClassTeachersPage(props: PageProps<"/school-admin/academics/class-teachers">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const session = await getCurrentSession(ctx);
  if (!session) return <SetupNotice title="Class teachers" need="session" />;

  const search = await props.searchParams;
  const classId = param(search.class);
  const onlyUnassigned = param(search.show) === "unassigned";

  const [sections, teachers] = await Promise.all([
    listSections(ctx, session.id),
    // Only active teachers can be assigned; the service enforces the same rule.
    ctx.db.teacher.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, employeeId: true },
    }),
  ]);

  const teacherOptions = teachers.map((teacher) => ({
    value: teacher.id,
    label: `${fullName(teacher)} (${teacher.employeeId})`,
  }));
  const classes = [...new Map(sections.map((s) => [s.class.id, s.class.name])).entries()];
  const visible = sections.filter(
    (section) => (!classId || section.class.id === classId) && (!onlyUnassigned || !section.classTeacher),
  );
  const assigned = sections.filter((section) => section.classTeacher).length;

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/academics", label: "Academics" }}
        title="Class teachers"
        description={`Teacher assignments · ${session.name}. Subject teachers are assigned on each teacher's page.`}
      />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Sections" value={sections.length} />
        <StatCard label="With a class teacher" value={assigned} />
        <StatCard
          label="No class teacher"
          value={sections.length - assigned}
          href="/school-admin/academics/class-teachers?show=unassigned"
        />
      </div>

      {sections.length ? (
        <>
          <FilterBar
            action="/school-admin/academics/class-teachers"
            selects={[
              {
                name: "class",
                label: "Class",
                defaultValue: classId,
                allLabel: "All classes",
                options: classes.map(([value, label]) => ({ value, label })),
              },
              {
                name: "show",
                label: "Show",
                defaultValue: onlyUnassigned ? "unassigned" : "",
                allLabel: "All sections",
                options: [{ value: "unassigned", label: "No class teacher only" }],
              },
            ]}
          />

          {visible.length ? (
            <ul className="divide-y rounded-xl border">
              {visible.map((section) => {
                const label = `${section.class.name} – ${section.name}${section.stream ? ` (${section.stream.name})` : ""}`;
                const current = section.classTeacher
                  ? { id: section.classTeacher.id, name: fullName(section.classTeacher) }
                  : null;
                return (
                  <li key={section.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_1.1fr_1.6fr] lg:items-center">
                    <div className="min-w-0">
                      <Link
                        href={`/school-admin/academics/sections/${section.id}` as Route}
                        className="font-medium hover:underline"
                      >
                        {label}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {section._count.enrollments} students
                      </p>
                    </div>
                    <div>
                      {current ? (
                        <Link
                          href={`/school-admin/teachers/${current.id}` as Route}
                          className="text-sm font-medium hover:underline"
                        >
                          {current.name}
                        </Link>
                      ) : (
                        <StatusBadge status="PENDING" label="No Class Teacher assigned" />
                      )}
                    </div>
                    <ClassTeacherControl
                      sectionId={section.id}
                      sectionLabel={label}
                      current={current}
                      teachers={teacherOptions}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Every section in view has a class teacher">
              Clear the filters to see all sections.
            </EmptyState>
          )}
        </>
      ) : (
        <EmptyState
          title="No sections in this session yet"
          action={
            <Link href="/school-admin/academics/classes" className="text-primary text-sm hover:underline">
              Create classes and sections
            </Link>
          }
        >
          Class teachers are assigned per section.
        </EmptyState>
      )}
    </>
  );
}
