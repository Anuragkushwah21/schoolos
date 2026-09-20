import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ApplicationForm } from "@/features/admissions/forms";
import { getAdmissionOptions, getPublicSchool } from "@/server/website/public";

export const metadata: Metadata = { title: "Admissions" };

const STEPS = [
  "Fill in the form — it takes about three minutes.",
  "You get an application number straight away.",
  "The school office reviews it and calls you on the number you give.",
];

export default async function PublicAdmissionsPage(props: PageProps<"/schools/[slug]/admissions">) {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const { classes, streams, sessionName } = await getAdmissionOptions(school.id);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.5fr]">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Admissions</h1>
          <p className="text-muted-foreground mt-2">
            Apply to {school.name}
            {sessionName ? ` for the ${sessionName} session` : ""}.
          </p>
        </div>

        <ol className="flex flex-col gap-4 text-sm">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                {index + 1}
              </span>
              <span className="text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>

        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
          Your details are sent only to {school.name}, and are used to contact
          you about this application.
        </p>
      </div>

      <div className="bg-card ring-foreground/10 rounded-2xl p-6 shadow-sm ring-1 sm:p-8">
        {classes.length && sessionName ? (
          <ApplicationForm
            slug={school.slug}
            classes={classes.map((klass) => ({ value: klass.id, label: klass.name }))}
            streams={streams.map((stream) => ({ value: stream.id, label: stream.name }))}
          />
        ) : (
          <EmptyState title="Applications are closed">
            {school.name} is not accepting online applications at the moment.
            Please contact the school office.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
