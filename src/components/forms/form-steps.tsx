"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { useFormContext } from "@/components/forms/action-form";
import { useT } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FormStep = { title: string; description?: string; content: React.ReactNode };

/**
 * A long form shown one step at a time, inside an existing `ActionForm`.
 *
 * Every step stays in the DOM (only hidden), so the form still submits all its
 * fields in one request to the same Server Action, and the server validates
 * exactly as before. "Next" checks the current step's fields with the
 * browser's own validation; if the server sends back an error for a field on
 * an earlier step, the form jumps to that step so the message is visible.
 */
export function FormSteps({ steps, submit }: { steps: FormStep[]; submit: React.ReactNode }) {
  const t = useT();
  const { fieldErrors } = useFormContext();
  const [current, setCurrent] = useState(0);
  const panels = useRef<Array<HTMLDivElement | null>>([]);
  const last = current === steps.length - 1;

  // Show the first step that holds a field the server rejected.
  useEffect(() => {
    if (!fieldErrors) return;
    const index = panels.current.findIndex((panel) => panel?.querySelector('[aria-invalid="true"]'));
    if (index >= 0) setCurrent(index);
  }, [fieldErrors]);

  function next() {
    const panel = panels.current[current];
    const fields = panel ? Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")) : [];
    const invalid = fields.find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    setCurrent((index) => Math.min(index + 1, steps.length - 1));
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2" aria-label={t("common.step", { current: current + 1, total: steps.length })}>
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step.title} className="flex items-center gap-2">
              <button
                type="button"
                // Earlier steps can be revisited; later ones open through "Next" so each is checked.
                onClick={() => index < current && setCurrent(index)}
                disabled={index > current}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors",
                  active && "border-primary bg-primary-soft text-primary-strong font-semibold",
                  done && "border-success/30 bg-success-soft text-success-strong",
                  !active && !done && "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-xs font-semibold",
                    active ? "bg-primary text-primary-foreground" : done ? "bg-success text-white" : "bg-muted",
                  )}
                  aria-hidden
                >
                  {done ? <CheckIcon className="size-3" /> : index + 1}
                </span>
                {step.title}
              </button>
            </li>
          );
        })}
      </ol>

      {steps.map((step, index) => (
        <div
          key={step.title}
          ref={(node) => {
            panels.current[index] = node;
          }}
          hidden={index !== current}
          className="flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6"
          // Enter in a text field moves on rather than submitting half a form.
          onKeyDown={(event) => {
            if (!last && event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
              event.preventDefault();
              next();
            }
          }}
        >
          <div>
            <p className="text-muted-foreground text-xs font-medium">{t("common.step", { current: index + 1, total: steps.length })}</p>
            <h2 className="text-lg font-semibold">{step.title}</h2>
            {step.description ? <p className="text-muted-foreground mt-1 text-sm">{step.description}</p> : null}
          </div>
          {step.content}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        {current > 0 ? (
          <Button type="button" variant="outline" size="lg" onClick={() => setCurrent((index) => index - 1)}>
            <ChevronLeftIcon aria-hidden />
            {t("common.back")}
          </Button>
        ) : null}
        {last ? (
          submit
        ) : (
          <Button type="button" size="lg" onClick={next}>
            {t("common.next")}
            <ChevronRightIcon aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
