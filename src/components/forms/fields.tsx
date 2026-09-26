"use client";

import { useId } from "react";

import { useFormContext } from "@/components/forms/action-form";
import { nativeSelectClass } from "@/components/forms/styles";
import { FieldError } from "@/components/shared/field-error";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const { pending } = useFormContext();
  return (
    <Button
      type="submit"
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
