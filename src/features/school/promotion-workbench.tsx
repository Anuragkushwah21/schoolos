"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { nativeSelectClass } from "@/components/forms/styles";
import { Spinner } from "@/components/shared/spinner";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { PromotionBatchResult, PromotionPreview } from "@/server/academics/promotion";

import { previewPromotionAction, promotionBatchAction } from "./promotion-actions";

/**
 * The whole promotion on one page: choose classes → review where each
 * section goes and who moves → confirm → watch it run → done.
 *
 * Nothing is written until "Confirm Promotion". The plan lives here in
 * memory; the server re-checks every student and section in every batch.
 */

type SourceClass = {
  id: string;
  name: string;
  sections: Array<{ id: string; label: string; name: string; students: number }>;
};
type Session = { id: string; name: string };
type Group = PromotionPreview["groups"][number];
type Choice = { include: boolean; repeat: boolean };

const BATCH = 100;

export function PromotionWorkbench({ from, to, classes }: { from: Session; to: Session; classes: SourceClass[] }) {
  const router = useRouter();
  const [step, setStep] = useState<"select" | "review" | "running" | "done">("select");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(classes.flatMap((k) => k.sections.map((s) => s.id))));
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [loading, startLoading] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState<{ totals: Omit<PromotionBatchResult, "skipped">; skipped: PromotionBatchResult["skipped"]; excluded: number; error: string | null } | null>(null);

  const allSectionIds = classes.flatMap((k) => k.sections.map((s) => s.id));
  const allPicked = allSectionIds.length > 0 && allSectionIds.every((id) => picked.has(id));

  function toggle(ids: string[], on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function loadPreview(sectionIds: string[]) {
    startLoading(async () => {
      const result = await previewPromotionAction({ fromSessionId: from.id, toSessionId: to.id, sectionIds });
      if (result.status !== "success") {
        toast.error(result.status === "error" ? result.message : "Could not load the preview.");
        return;
      }
      const data = result.data;
      setPreview(data);
      setDestinations(Object.fromEntries(data.groups.map((g) => [g.fromSectionId, g.suggested])));
      // Ready students start ticked; anyone who needs a look starts unticked.
      setChoices(
        Object.fromEntries(
          data.groups.flatMap((g) => g.students.map((s) => [s.studentId, { include: s.eligibility === "READY", repeat: false }])),
        ),
      );
      setStep("review");
    });
  }

  const summary = useMemo(() => {
    const students = preview?.groups.flatMap((g) => g.students) ?? [];
    const selected = students.filter((s) => s.eligibility !== "BLOCKED" && choices[s.studentId]?.include);
    const graduating = preview
      ? preview.groups
          .filter((g) => destinations[g.fromSectionId] === "GRADUATE")
          .flatMap((g) => g.students)
          .filter((s) => s.eligibility !== "BLOCKED" && choices[s.studentId]?.include && !choices[s.studentId]?.repeat).length
      : 0;
    return {
      total: students.length,
      ready: students.filter((s) => s.eligibility === "READY").length,
      review: students.filter((s) => s.eligibility === "REVIEW").length,
      blocked: students.filter((s) => s.eligibility === "BLOCKED").length,
      selected: selected.length,
      repeating: selected.filter((s) => choices[s.studentId]?.repeat).length,
      graduating,
    };
  }, [preview, choices, destinations]);

  function setChoice(studentId: string, patch: Partial<Choice>) {
    setChoices((current) => ({ ...current, [studentId]: { ...(current[studentId] ?? { include: false, repeat: false }), ...patch } }));
  }

  async function run() {
    if (!preview) return;
    setConfirmOpen(false);
    const runId = crypto.randomUUID();
    const batches = preview.groups.flatMap((group) => {
      const students = group.students
        .filter((s) => s.eligibility !== "BLOCKED" && choices[s.studentId]?.include)
        .map((s) => ({ studentId: s.studentId, repeat: Boolean(choices[s.studentId]?.repeat) }));
      const chunks = [];
      for (let i = 0; i < students.length; i += BATCH) chunks.push(students.slice(i, i + BATCH));
      return chunks.map((chunk) => ({ group, students: chunk }));
    });

    const total = batches.reduce((sum, b) => sum + b.students.length, 0);
    setProgress({ done: 0, total });
    setStep("running");

    const totals = { promoted: 0, repeated: 0, graduated: 0 };
    const skipped: PromotionBatchResult["skipped"] = [];
    let error: string | null = null;
    let done = 0;
    // One batch at a time: each is its own transaction, and the count below
    // only moves once a batch has been saved.
    for (const batch of batches) {
      const result = await promotionBatchAction({
        runId,
        fromSessionId: preview.from.id,
        toSessionId: preview.to.id,
        fromSectionId: batch.group.fromSectionId,
        destination: destinations[batch.group.fromSectionId],
        students: batch.students,
      });
      if (result.status !== "success") {
        error = `${batch.group.fromLabel}: ${result.status === "error" ? result.message : "Something went wrong."}`;
        break;
      }
      totals.promoted += result.data.promoted;
      totals.repeated += result.data.repeated;
      totals.graduated += result.data.graduated;
      skipped.push(...result.data.skipped);
      done += batch.students.length;
      setProgress({ done, total });
    }

    setOutcome({ totals, skipped, excluded: summary.total - summary.selected, error });
    setStep("done");
    router.refresh();
  }

  // ---------------------------------------------------------------------------

  if (step === "running") {
    const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <Card aria-live="polite">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Spinner size="sm" /> Promoting students…
          </CardTitle>
          <CardDescription>Please keep this page open until it finishes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="bg-muted h-3 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="bg-primary h-full transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-sm tabular-nums">
            {progress.done} / {progress.total} completed
          </p>
        </CardContent>
      </Card>
    );
  }

  if (step === "done" && outcome) {
    const moved = outcome.totals.promoted + outcome.totals.repeated;
    const exceptions = outcome.skipped.length + outcome.excluded;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{outcome.error ? "Promotion stopped" : "Promotion complete"}</CardTitle>
          <CardDescription>
            {from.name} → {to.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {outcome.error ? (
            <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-3">
              <p className="font-medium">{outcome.error}</p>
              <p className="text-muted-foreground mt-1">
                Nothing in that section was changed. Students promoted before it stay promoted. Fix the problem and
                review again — anyone already moved will show as already placed and will not be moved twice.
              </p>
            </div>
          ) : null}
          <ul className="flex flex-col gap-1">
            <li>
              <strong className="tabular-nums">{outcome.totals.promoted}</strong> students promoted successfully.
            </li>
            {outcome.totals.repeated ? (
              <li>
                <strong className="tabular-nums">{outcome.totals.repeated}</strong> kept in the same class for {to.name}.
              </li>
            ) : null}
            {outcome.totals.graduated ? (
              <li>
                <strong className="tabular-nums">{outcome.totals.graduated}</strong> graduated.
              </li>
            ) : null}
            <li>
              <strong className="tabular-nums">{exceptions}</strong> students need review (not moved).
            </li>
          </ul>
          {outcome.skipped.length ? (
            <ul className="divide-y rounded-lg border">
              {outcome.skipped.map((s) => (
                <li key={s.studentId} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <Link href={`/school-admin/students/${s.studentId}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                  <span className="text-muted-foreground">{s.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {moved ? (
              <Button asChild>
                <Link href={`/school-admin/students/bulk?session=${to.id}`}>View promoted students</Link>
              </Button>
            ) : null}
            {exceptions || outcome.error ? (
              <Button variant="outline" disabled={loading} onClick={() => preview && loadPreview(preview.groups.map((g) => g.fromSectionId))}>
                {loading ? <Spinner size="xs" /> : null}
                Review exceptions
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/school-admin/setup?session=${to.id}`}>Set up {to.name}: class teachers, subjects, timetable</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/school-admin/academics">Back to Academics</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "review" && preview) {
    const needsLook = preview.groups.flatMap((g) => g.students.filter((s) => s.eligibility !== "READY").map((s) => ({ ...s, from: g.fromLabel })));
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Total students" value={summary.total} />
          <Tile label="Ready to promote" value={summary.ready} />
          <Tile label="Needs review" value={summary.review} />
          <Tile label="Not eligible" value={summary.blocked} />
        </div>

        {needsLook.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Needs review</CardTitle>
              <CardDescription>
                These students are not ticked. Include the ones who should move up; anyone left unticked keeps their {preview.from.name} place as it is.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y rounded-lg border">
                {needsLook.map((s) => (
                  <li key={s.studentId} className="flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {s.name} <span className="text-muted-foreground font-normal">· {s.from}</span>
                      </p>
                      <p className="text-muted-foreground text-xs">{s.reason}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {s.eligibility === "REVIEW" ? (
                        choices[s.studentId]?.include ? (
                          <Button size="xs" variant="outline" onClick={() => setChoice(s.studentId, { include: false })}>
                            Keep current
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" onClick={() => setChoice(s.studentId, { include: true })}>
                            Include
                          </Button>
                        )
                      ) : (
                        <StatusBadge status="BLOCKED" tone="negative" label="Not eligible" />
                      )}
                      <Button asChild size="xs" variant="ghost">
                        <Link href={`/school-admin/students/${s.studentId}`} target="_blank">
                          Review
                        </Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Where each section goes</CardTitle>
            <CardDescription>
              Suggested: the same section letter in the next class. Change any row — to another section, a merged
              section, or graduation. New sections start with no class teacher.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {preview.groups.map((group) => (
              <GroupRow
                key={group.fromSectionId}
                group={group}
                destination={destinations[group.fromSectionId] ?? group.suggested}
                onDestination={(value) => setDestinations((d) => ({ ...d, [group.fromSectionId]: value }))}
                choices={choices}
                onChoice={setChoice}
              />
            ))}
          </CardContent>
        </Card>

        <div className="bg-background/95 sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t py-3">
          <p className="text-sm">
            <strong className="tabular-nums">{summary.selected}</strong> of {summary.total} students selected
            {summary.repeating ? ` · ${summary.repeating} staying in the same class` : ""}
            {summary.graduating ? ` · ${summary.graduating} graduating` : ""}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("select")}>
              Back
            </Button>
            <Button disabled={!summary.selected} onClick={() => setConfirmOpen(true)}>
              Promote {summary.selected} students
            </Button>
          </div>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Promote {summary.selected} students?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="flex flex-col gap-2">
                  <p className="text-foreground font-medium">
                    {preview.from.name} → {preview.to.name}
                  </p>
                  <p>Their new class and section places for {preview.to.name} will be created.</p>
                  {summary.repeating ? <p>{summary.repeating} will stay in their current class for another year.</p> : null}
                  {summary.graduating ? (
                    <p>{summary.graduating} will be marked graduated, and their student sign-in will close.</p>
                  ) : null}
                  <p>Previous academic records — attendance, marks, homework, reports and fees — will remain unchanged.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={run}>Confirm Promotion</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Step: choose classes -------------------------------------------------------
  if (!classes.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No sections in {from.name}</CardTitle>
          <CardDescription>There is nobody to promote from this session.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Choose classes · {from.name} → {to.name}
        </CardTitle>
        <CardDescription>Nothing changes yet — the next step shows exactly who moves where.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={allPicked} onCheckedChange={(on) => toggle(allSectionIds, on === true)} />
          All classes
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((klass) => {
            const ids = klass.sections.map((s) => s.id);
            const all = ids.every((id) => picked.has(id));
            const some = ids.some((id) => picked.has(id));
            return (
              <div key={klass.id} className="rounded-lg border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(on) => toggle(ids, on === true)} />
                  {klass.name}
                </label>
                {klass.sections.length > 1 ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-6">
                    {klass.sections.map((section) => (
                      <label key={section.id} className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <Checkbox checked={picked.has(section.id)} onCheckedChange={(on) => toggle([section.id], on === true)} />
                        Section {section.name} ({section.students})
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground mt-1 pl-6 text-xs">{klass.sections[0]?.students ?? 0} students</p>
                )}
              </div>
            );
          })}
        </div>
        <div>
          <Button disabled={!picked.size || loading} onClick={() => loadPreview([...picked])}>
            {loading ? <Spinner size="xs" /> : null}
            Review promotion
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function GroupRow({
  group,
  destination,
  onDestination,
  choices,
  onChoice,
}: {
  group: Group;
  destination: string;
  onDestination: (value: string) => void;
  choices: Record<string, Choice>;
  onChoice: (studentId: string, patch: Partial<Choice>) => void;
}) {
  const selected = group.students.filter((s) => s.eligibility !== "BLOCKED" && choices[s.studentId]?.include).length;
  const graduating = destination === "GRADUATE";
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="min-w-40 font-medium">{group.fromLabel}</p>
        <span aria-hidden className="text-muted-foreground hidden sm:inline">
          →
        </span>
        <select
          aria-label={`Destination for ${group.fromLabel}`}
          className={`${nativeSelectClass} min-w-0 flex-1`}
          value={destination}
          onChange={(event) => onDestination(event.target.value)}
        >
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
          {selected} / {group.students.length} students
        </span>
      </div>
      {group.isFinalClass ? (
        <p className="text-muted-foreground mt-2 text-xs">Final class — there is no higher class, so these students graduate unless you choose otherwise.</p>
      ) : null}
      {group.students.length ? (
        <details className="mt-2 text-sm">
          <summary className="text-muted-foreground cursor-pointer text-xs">Students</summary>
          <ul className="mt-2 divide-y rounded-md border">
            {group.students.map((s) => {
              const choice = choices[s.studentId];
              const blocked = s.eligibility === "BLOCKED";
              return (
                <li key={s.studentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <Checkbox
                      checked={!blocked && Boolean(choice?.include)}
                      disabled={blocked}
                      onCheckedChange={(on) => onChoice(s.studentId, { include: on === true })}
                    />
                    <span className={blocked ? "text-muted-foreground" : ""}>
                      {s.rollNumber ? <span className="text-muted-foreground tabular-nums">{s.rollNumber}. </span> : null}
                      {s.name}
                    </span>
                    {s.eligibility === "REVIEW" ? <StatusBadge status="REVIEW" tone="warning" label="Review" /> : null}
                    {blocked ? <StatusBadge status="BLOCKED" tone="negative" label="Not eligible" /> : null}
                  </label>
                  {!blocked && choice?.include ? (
                    <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Checkbox checked={choice.repeat} onCheckedChange={(on) => onChoice(s.studentId, { repeat: on === true })} />
                      {graduating ? "Don't graduate — " : ""}Stay in {group.repeatLabel}
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">Empty section — nothing to promote.</p>
      )}
    </div>
  );
}
