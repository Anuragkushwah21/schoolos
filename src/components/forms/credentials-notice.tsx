"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, KeyRoundIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shows a newly issued password exactly once.
 *
 * The password is never stored in plain text and cannot be retrieved later;
 * if it is lost, the administrator issues a new one.
 */
export function CredentialsNotice({
  email,
  password,
  label = "Sign-in details",
}: {
  email: string;
  password: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="flex items-center gap-2 font-medium">
        <KeyRoundIcon className="size-4" aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-amber-900/80 dark:text-amber-100/80">
        Share these now — the password is shown only once and cannot be
        recovered later.
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[0.8rem]">
        <dt className="text-amber-900/70 dark:text-amber-100/70">Email</dt>
        <dd className="break-all">{email}</dd>
        <dt className="text-amber-900/70 dark:text-amber-100/70">Password</dt>
        <dd>{password}</dd>
      </dl>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={async () => {
          await navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`);
          setCopied(true);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/**
 * A single secret — an API token — shown once at creation.
 *
 * Only a hash is stored, so this is the one moment it can be copied. If it is
 * lost, the answer is to issue another and revoke this one.
 */
export function SecretNotice({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="flex items-center gap-2 font-medium">
        <KeyRoundIcon className="size-4" aria-hidden />
        {label}
      </p>
      {hint ? <p className="mt-1 text-amber-900/80 dark:text-amber-100/80">{hint}</p> : null}
      <p className="mt-3 overflow-x-auto rounded-md bg-amber-100/70 px-3 py-2 font-mono text-[0.8rem] break-all dark:bg-amber-900/40">
        {value}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
