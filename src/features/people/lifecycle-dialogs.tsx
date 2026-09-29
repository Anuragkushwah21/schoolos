"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { KeyRoundIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { nativeSelectClass } from "@/components/forms/styles";
import { useT, useTranslateDynamic } from "@/components/i18n/i18n-provider";
import { FieldError } from "@/components/shared/field-error";
import { Spinner } from "@/components/shared/spinner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { humanize } from "@/lib/format";

import { changeStatusAction, loginAccessAction } from "./lifecycle-actions";

type Result = ActionResult<undefined>;
const idle: Result = { status: "idle" };

/** Run a Server Action from a form; close the dialog and toast on success. */
function useDialogAction(action: (state: Result, formData: FormData) => Promise<Result>) {
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useActionState(action, idle);
  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the dialog in response to the server's answer
      setOpen(false);
    } else if (state.status === "error" && !state.fieldErrors) {
      toast.error(state.message);
    }
  }, [state]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { open, setOpen, state, pending, submit, fieldErrors: state.status === "error" ? state.fieldErrors : undefined };
}

/**
 * "Change status" — never a single click: the new status, the date it takes
 * effect, a reason, and a clear warning, then an explicit confirmation.
 * Bringing back someone who had left needs one more tick.
 */
export function ChangeStatusDialog({
  person,
  personId,
  name,
  current,
  statuses,
  left,
  today,
}: {
  person: "STUDENT" | "TEACHER" | "STAFF";
  personId: string;
  name: string;
  current: string;
  statuses: readonly string[];
  /** Statuses meaning "has left" for this kind of person. */
  left: readonly string[];
  today: string;
}) {
  const t = useT();
  const translate = useTranslateDynamic();
  const { open, setOpen, pending, submit, fieldErrors } = useDialogAction(changeStatusAction);
  const [next, setNext] = useState(statuses.find((status) => status !== current) ?? "");
  const returning = left.includes(current) && !left.includes(next);
  const label = (status: string) => translate(`status.${status}`, humanize(status));
  // Say exactly what will happen, in words, for the status chosen.
  const effect = returning
    ? "back"
    : left.includes(next)
      ? person === "STUDENT"
        ? "leftStudent"
        : person === "TEACHER"
          ? "leftTeacher"
          : "leftStaff"
      : next === "SUSPENDED"
        ? "suspended"
        : next === "ON_LEAVE"
          ? "onLeave"
          : "back";
  const title = translate(`lifecycle.confirmTitle.${next}`, t("lifecycle.changeStatus")).replace("{name}", name);
  const confirmLabel = translate(`lifecycle.confirmButton.${next}`, t("lifecycle.confirmChange"));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <RefreshCwIcon aria-hidden />
          {t("lifecycle.changeStatus")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              <StatusBadge status={current} />
              <span aria-hidden>→</span>
              {next ? <StatusBadge status={next} /> : null}
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="person" value={person} />
          <input type="hidden" name="personId" value={personId} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="lc-status">{t("lifecycle.newStatus")}</Label>
            <select id="lc-status" name="status" value={next} onChange={(event) => setNext(event.target.value)} className={`${nativeSelectClass} w-full`} required>
              {statuses
                .filter((status) => status !== current)
                .map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
            </select>
            <FieldError id="lc-status-error" messages={fieldErrors?.status} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="lc-date">{t("lifecycle.effectiveDate")}</Label>
            <Input id="lc-date" name="effectiveDate" type="date" defaultValue={today} max={today} required aria-describedby="lc-date-hint" />
            <p id="lc-date-hint" className="text-muted-foreground text-xs">
              {t("lifecycle.effectiveDateHint")}
            </p>
            <FieldError id="lc-date-error" messages={fieldErrors?.effectiveDate} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="lc-reason">{t("lifecycle.reason")}</Label>
            <Input id="lc-reason" name="reason" placeholder={t("lifecycle.reasonPlaceholder")} maxLength={200} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="lc-remarks">
              {t("lifecycle.remarks")} <span className="text-muted-foreground font-normal">({t("common.optional")})</span>
            </Label>
            <Textarea id="lc-remarks" name="remarks" rows={2} maxLength={1000} />
          </div>

          {returning ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirmReturn" className="accent-primary mt-0.5 size-4" required />
              {t("lifecycle.confirmReturn")}
            </label>
          ) : null}
          <FieldError id="lc-return-error" messages={fieldErrors?.confirmReturn} />

          <p role="note" className="bg-warning-soft text-warning-strong border-warning/30 flex gap-2 rounded-lg border px-3 py-2 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {translate(`lifecycle.effect.${effect}`, t("lifecycle.warning")).replace("{name}", name)}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !next} aria-busy={pending || undefined}>
              {pending ? <Spinner /> : null}
              {pending ? t("lifecycle.changing") : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Manage login" — separate from status. Disabling signs the person out at
 * once; enabling is refused by the server while their status forbids it.
 */
export function ManageLoginDialog({
  person,
  personId,
  name,
  login,
  maySignIn,
}: {
  person: "STUDENT" | "PARENT" | "TEACHER" | "STAFF";
  personId: string;
  name: string;
  login: "ACTIVE" | "DISABLED" | "LOCKED";
  maySignIn: boolean;
}) {
  const t = useT();
  const { open, setOpen, pending, submit } = useDialogAction(loginAccessAction);
  const enabling = login !== "ACTIVE";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <KeyRoundIcon aria-hidden />
          {t("lifecycle.manageLogin")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{enabling ? t("lifecycle.enableConfirm", { name }) : t("lifecycle.disableConfirm", { name })}</DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              {t("lifecycle.login")}: <StatusBadge status={login} />
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="person" value={person} />
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="enabled" value={enabling ? "true" : "false"} />
          <p className="text-muted-foreground text-sm">
            {enabling ? (maySignIn ? t("lifecycle.enableHint") : t("lifecycle.cannotEnable")) : t("lifecycle.disableHint")}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lg-reason">
              {t("lifecycle.reason")} <span className="text-muted-foreground font-normal">({t("common.optional")})</span>
            </Label>
            <Input id="lg-reason" name="reason" maxLength={200} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant={enabling ? "default" : "destructive"} disabled={pending || (enabling && !maySignIn)} aria-busy={pending || undefined}>
              {pending ? <Spinner /> : null}
              {enabling ? t("lifecycle.enableLogin") : t("lifecycle.disableLogin")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
