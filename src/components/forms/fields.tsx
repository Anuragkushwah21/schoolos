"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useFormContext } from "@/components/forms/action-form";
import { nativeSelectClass } from "@/components/forms/styles";
import { FieldError } from "@/components/shared/field-error";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PHONE_COUNTRIES, type PhoneCountryCode, parsePhone, phoneCountry, splitPhoneForInput } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * Labelled inputs that pick up their validation message from the enclosing
 * `ActionForm`. Each wires `aria-invalid` and `aria-describedby` so a screen
 * reader announces the error against the field it belongs to.
 */

type BaseFieldProps = {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
};

function useField(name: string) {
  const { fieldErrors } = useFormContext();
  const reactId = useId();
  const inputId = `${name}-${reactId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const messages = fieldErrors?.[name];
  return { inputId, errorId, hintId, messages, invalid: Boolean(messages?.length) };
}

function FieldFrame({
  label,
  hint,
  required,
  className,
  field,
  children,
}: Omit<BaseFieldProps, "name"> & {
  field: ReturnType<typeof useField>;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={field.inputId}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint && !field.invalid ? (
        <p id={field.hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <FieldError id={field.errorId} messages={field.messages} />
    </div>
  );
}

function describedBy(field: ReturnType<typeof useField>, hint?: string) {
  if (field.invalid) return field.errorId;
  return hint ? field.hintId : undefined;
}

export function TextField({
  name,
  label,
  hint,
  required,
  className,
  ...inputProps
}: BaseFieldProps &
  Omit<React.ComponentProps<"input">, "name" | "id" | "required">) {
  const field = useField(name);
  return (
    <FieldFrame {...{ label, hint, required, className, field }}>
      <Input
        id={field.inputId}
        name={name}
        aria-required={required || undefined}
        aria-invalid={field.invalid || undefined}
        aria-describedby={describedBy(field, hint)}
        {...inputProps}
      />
    </FieldFrame>
  );
}

/**
 * The one phone input: a country code (+91 preselected) and the local number,
 * digits only and never more than the country allows (10 for India). Letters
 * and extra digits are refused as they are typed or pasted; a pasted
 * "+91 98765 43210", "09876543210" or "919876543210" is read correctly.
 *
 * It submits a single field, `name`, as "+91 9876543210" (empty when blank),
 * so the server schemas (`requiredPhone` / `optionalPhone`) see one value and
 * apply the same rule again. Works uncontrolled (`defaultValue`) or
 * controlled (`value` + `onChange`, which receives that same string).
 */
export function PhoneField({
  name,
  label,
  hint,
  required,
  className,
  defaultValue,
  value,
  onChange,
  disabled,
  autoComplete = "tel-national",
  placeholder,
}: BaseFieldProps & {
  defaultValue?: string | null;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  autoComplete?: string;
  placeholder?: string;
}) {
  const field = useField(name);
  const initial = splitPhoneForInput(value ?? defaultValue);
  const [country, setCountry] = useState<PhoneCountryCode>(initial.country);
  const [digits, setDigits] = useState(initial.digits);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const rule = phoneCountry(country) ?? PHONE_COUNTRIES[0];
  const combined = digits ? `${country} ${digits}` : "";

  // Controlled: take a new value from the parent (e.g. an existing parent picked).
  const [seen, setSeen] = useState(value);
  if (value !== undefined && value !== seen) {
    setSeen(value);
    if (value !== combined) {
      const next = splitPhoneForInput(value);
      setCountry(next.country);
      setDigits(next.digits);
    }
  }

  // A form reset (after a successful add) clears this field too.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const onReset = () => {
      const next = splitPhoneForInput(defaultValue);
      setCountry(next.country);
      setDigits(next.digits);
      setNotice(null);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue]);

  function update(nextCountry: PhoneCountryCode, nextDigits: string) {
    setCountry(nextCountry);
    setDigits(nextDigits);
    onChange?.(nextDigits ? `${nextCountry} ${nextDigits}` : "");
  }

  function onType(raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (clean !== raw.replace(/[\s-]/g, "")) setNotice("Digits only — letters and symbols are not allowed.");
    else if (clean.length > rule.max) setNotice(`At most ${rule.max} digits after ${rule.code}.`);
    else setNotice(null);
    update(country, clean.slice(0, rule.max));
  }

  function onPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    const parsed = parsePhone(text);
    event.preventDefault();
    if (parsed) {
      setNotice(null);
      update(parsed.country, parsed.digits);
      return;
    }
    const pastedDigits = text.replace(/[\s\-().]/g, "");
    if (!/^\d*$/.test(pastedDigits)) {
      setNotice("That paste has letters or symbols — only digits are allowed.");
      return;
    }
    // Digits pasted into the middle of what is already there.
    const el = event.currentTarget;
    const start = el.selectionStart ?? digits.length;
    const end = el.selectionEnd ?? digits.length;
    const next = digits.slice(0, start) + pastedDigits + digits.slice(end);
    if (next.length > rule.max) {
      setNotice(`That number has too many digits — at most ${rule.max} after ${rule.code}.`);
      return;
    }
    setNotice(null);
    update(country, next);
  }

  const incomplete = digits.length > 0 && digits.length < rule.min;
  return (
    <FieldFrame {...{ label, hint, required, className, field }}>
      <div className="flex gap-2">
        <select
          aria-label={`${label}: country code`}
          value={country}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value as PhoneCountryCode;
            const max = phoneCountry(next)?.max ?? 10;
            setNotice(digits.length > max ? `At most ${max} digits after ${next}.` : null);
            update(next, digits.slice(0, max));
          }}
          className={cn(nativeSelectClass, "w-[5.5rem] shrink-0")}
        >
          {PHONE_COUNTRIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.code} {option.label}
            </option>
          ))}
        </select>
        <Input
          ref={input}
          id={field.inputId}
          type="tel"
          inputMode="numeric"
          autoComplete={autoComplete}
          maxLength={rule.max}
          value={digits}
          disabled={disabled}
          placeholder={placeholder ?? (rule.code === "+91" ? "9876543210" : `${rule.max} digits`)}
          onChange={(event) => onType(event.target.value)}
          onPaste={onPaste}
          onBlur={() => {
            if (incomplete) setNotice(`Enter ${rule.min === rule.max ? rule.max : `${rule.min}–${rule.max}`} digits after ${rule.code}.`);
          }}
          aria-required={required || undefined}
          aria-invalid={field.invalid || Boolean(notice && incomplete) || undefined}
          aria-describedby={describedBy(field, hint)}
          className="min-w-0 flex-1 tabular-nums"
        />
        <input type="hidden" name={name} value={combined} />
      </div>
      {notice && !field.invalid ? (
        <p className="text-warning-strong text-xs" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </FieldFrame>
  );
}

export function TextareaField({
  name,
  label,
  hint,
  required,
  className,
  ...textareaProps
}: BaseFieldProps &
  Omit<React.ComponentProps<"textarea">, "name" | "id" | "required">) {
  const field = useField(name);
  return (
    <FieldFrame {...{ label, hint, required, className, field }}>
      <Textarea
        id={field.inputId}
        name={name}
        aria-required={required || undefined}
        aria-invalid={field.invalid || undefined}
        aria-describedby={describedBy(field, hint)}
        {...textareaProps}
      />
    </FieldFrame>
  );
}

export type SelectOption = { value: string; label: string };

/** A native `<select>`: submits with FormData and works before hydration. */
export function SelectField({
  name,
  label,
  hint,
  required,
  className,
  options,
  placeholder,
  ...selectProps
}: BaseFieldProps & {
  options: SelectOption[];
  /** Adds an empty first option, for optional choices. */
  placeholder?: string;
} & Omit<React.ComponentProps<"select">, "name" | "id" | "required">) {
  const field = useField(name);
  return (
    <FieldFrame {...{ label, hint, required, className, field }}>
      <select
        id={field.inputId}
        name={name}
        className={cn(nativeSelectClass, "w-full")}
        aria-required={required || undefined}
        aria-invalid={field.invalid || undefined}
        aria-describedby={describedBy(field, hint)}
        {...selectProps}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

export function CheckboxField({
  name,
  label,
  hint,
  className,
  defaultChecked,
}: Omit<BaseFieldProps, "required"> & { defaultChecked?: boolean }) {
  const field = useField(name);
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        id={field.inputId}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        aria-describedby={hint ? field.hintId : undefined}
        className="accent-primary mt-0.5 size-4 shrink-0 rounded"
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor={field.inputId} className="font-normal">
          {label}
        </Label>
        {hint ? (
          <p id={field.hintId} className="text-muted-foreground text-xs">
            {hint}
          </p>
        ) : null}
        <FieldError id={field.errorId} messages={field.messages} />
      </div>
    </div>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  className,
  variant,
  size,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  /** Sent with the form when this button submits it — for forms with several operations. */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormContext();
  return (
    <Button
      type="submit"
      name={name}
      value={value}
      // Disabled while the action runs, which is also what makes a second
      // submission impossible — the guard is the same thing as the feedback.
      disabled={pending}
      aria-busy={pending || undefined}
      className={className}
      variant={variant}
      size={size}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? "Saving…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** Two-up layout for related fields; collapses to one column on phones. */
export function FieldRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5 sm:grid-cols-2", className)}>{children}</div>
  );
}
