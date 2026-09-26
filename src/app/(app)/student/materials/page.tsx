import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentTabs } from "@/features/student/nav";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getMyMaterials } from "@/server/student/me";

export const metadata: Metadata = { title: "Study material" };

/**
 * Everything the student's teachers have attached, in one place.
 *
 * The same rows the lesson pages show, gathered across lessons so a student
 * revising a subject does not have to open each class to find the notes. Links
 * and documents are URLs the school already hosts — there is no upload pipeline
 * in this version, and no third-party storage was added for this.
 */
export default async function StudentMaterialsPage(props: PageProps<"/student/materials">) {
  const ctx = await requireTenant("STUDENT");
  const search = await props.searchParams;
  const subjectId = param(search.subject);

  const { me, subjects, materials } = await orNotFound(getMyMaterials(ctx, { subjectId }));

  return (
    <>
      <PageHeader
        title="Study material"
        description={`${me.placement.sectionLabel} · notes, links and practice work from your teachers`}
      />
      <StudentTabs active="materials" />

      <FilterBar
        action="/student/materials"
        selects={[
          {
            name: "subject",
            label: "Subject",
            defaultValue: subjectId,
            allLabel: "All subjects",
            options: subjects.map((subject) => ({ value: subject.id, label: subject.name })),
          },
        ]}
      />

      {materials.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {materials.map((material) => (
            <Card key={material.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-base">{material.title}</CardTitle>
                  <StatusBadge status="INACTIVE" label={humanize(material.kind)} tone="neutral" />
                </div>
                <CardDescription>
                  {material.subject}
                  {material.lessonTopic ? ` · ${material.lessonTopic}` : ""} ·{" "}
                  {formatDate(material.lessonDate)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {material.body ? (
                  <p className="text-sm whitespace-pre-line">{material.body}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {material.url ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={material.url} target="_blank" rel="noopener noreferrer">
                        Open ↗
                      </a>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/student/lessons/${material.lessonId}` as Route}>
                      See the class
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title={subjectId ? "Nothing in that subject yet" : "No material yet"}>
          When a teacher attaches notes, a link, questions or practice work to one of your classes,
          it appears here and on that class.
        </EmptyState>
      )}
    </>
  );
}
