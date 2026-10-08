"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { FieldRow, SelectField, SubmitButton, TextField } from "@/components/forms/fields";
import { Input } from "@/components/ui/input";
import { rupees, toRupeeInput } from "@/features/finance/money";

import {
  grantConcessionAction,
  recordFamilyPaymentAction,
  setFamilyPaymentEnabledAction,
  voidFamilyPaymentAction,
} from "./family-actions";

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

/** School Admin: a fixed amount or a percentage off one charge, with a reason. */
export function ConcessionForm({ chargeId, originalMinor }: { chargeId: string; originalMinor: number }) {
  const [kind, setKind] = useState<"FIXED" | "PERCENT">("FIXED");
  const [value, setValue] = useState("");
  const amount = Number(value);
  const discount = !Number.isFinite(amount) || amount <= 0 ? 0 : kind === "FIXED" ? Math.min(Math.round(amount * 100), originalMinor) : Math.round((originalMinor * Math.min(amount, 100)) / 100);
  return (
    <ActionForm action={grantConcessionAction} className="gap-3">
      <input type="hidden" name="chargeId" value={chargeId} />
      <FieldRow>
        <SelectField
          name="kind"
          label="Concession"
          value={kind}
          onChange={(event) => setKind(event.target.value as "FIXED" | "PERCENT")}
          options={[
            { value: "FIXED", label: "Fixed amount (₹)" },
            { value: "PERCENT", label: "Percentage (%)" },
          ]}
          required
        />
        <TextField
          name={kind === "FIXED" ? "amountRupees" : "percent"}
          label={kind === "FIXED" ? "Amount off (₹)" : "Percent off"}
          type="number"
          min={0}
          max={kind === "PERCENT" ? 100 : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
        />
      </FieldRow>
      <TextField name="reason" label="Reason" placeholder="Sibling discount, merit scholarship…" maxLength={300} required />
      <p className="bg-muted/60 rounded-lg px-3 py-2 text-sm tabular-nums">
        Original {rupees(originalMinor)} − discount {rupees(discount)} = <strong>net {rupees(originalMinor - discount)}</strong>
      </p>
      <div>
        <SubmitButton variant="outline">Give concession</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function FamilyPaymentSwitch({ enabled }: { enabled: boolean }) {
  return (
    <ActionForm action={setFamilyPaymentEnabledAction} className="gap-3">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <div>
        <SubmitButton variant={enabled ? "outline" : "default"}>{enabled ? "Switch family payments off" : "Switch family payments on"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * One payment for several children: an amount per child (never more than
 * they owe), one method and date. Each child's share becomes their own
 * receipt under one family receipt.
 */
export function FamilyPaymentForm({
  parentId,
  childrenDue,
  today,
  back,
}: {
  parentId: string;
  childrenDue: Array<{ id: string; name: string; pendingMinor: number }>;
  today: string;
  back: "/school-admin/finance/family" | "/staff/fees/family";
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(childrenDue.map((child) => [child.id, child.pendingMinor ? toRupeeInput(child.pendingMinor) : ""])),
  );
  const total = Object.values(amounts).reduce((sum, value) => sum + (Number(value) > 0 ? Math.round(Number(value) * 100) : 0), 0);
  // One key per form: a double press or a retried request takes the money once.
  const [idempotencyKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  return (
    <ActionForm action={recordFamilyPaymentAction}>
      <input type="hidden" name="parentId" value={parentId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="back" value={back} />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-muted-foreground text-left text-xs uppercase">
            <tr>
              <th className="px-3 py-2 font-semibold">Child</th>
              <th className="px-3 py-2 text-right font-semibold">Owes this session</th>
              <th className="w-40 px-3 py-2 font-semibold">Paying now (₹)</th>
            </tr>
          </thead>
          <tbody>
            {childrenDue.map((child) => (
              <tr key={child.id} className="border-t">
                <td className="px-3 py-2 font-medium">{child.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rupees(child.pendingMinor)}</td>
                <td className="px-3 py-2">
                  <Input
                    name={`amount:${child.id}`}
                    aria-label={`Amount for ${child.name}`}
                    type="number"
                    min={0}
                    max={child.pendingMinor / 100}
                    value={amounts[child.id] ?? ""}
                    onChange={(event) => setAmounts((current) => ({ ...current, [child.id]: event.target.value }))}
                    disabled={child.pendingMinor === 0}
                  />
                </td>
              </tr>
            ))}
            <tr className="bg-muted/40 border-t font-semibold">
              <td className="px-3 py-2">Family total</td>
              <td />
              <td className="px-3 py-2 tabular-nums">{rupees(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <FieldRow>
        <TextField name="paidOn" label="Paid on" type="date" defaultValue={today} max={today} required />
        <SelectField name="method" label="Method" options={METHODS} defaultValue="CASH" required />
      </FieldRow>
      <FieldRow>
        <TextField name="referenceNo" label="Reference (UPI / cheque no.)" maxLength={60} />
        <TextField name="notes" label="Notes" maxLength={300} />
      </FieldRow>
      <div>
        <SubmitButton pendingLabel="Recording…">Record family payment of {rupees(total)}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function VoidFamilyPaymentForm({ familyPaymentId }: { familyPaymentId: string }) {
  return (
    <ActionForm action={voidFamilyPaymentAction} className="gap-3">
      <input type="hidden" name="familyPaymentId" value={familyPaymentId} />
      <TextField name="reason" label="Why is it being voided?" placeholder="Cheque bounced" maxLength={200} required />
      <div>
        <SubmitButton variant="destructive">Void family payment</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * For a parent: tick the children to pay for together and see the combined
 * amount and its split. SchoolOS has no online payment gateway, so this is
 * what to pay at the fee desk, which records it as one family payment.
 */
export function FamilyPayCalculator({ childrenDue }: { childrenDue: Array<{ id: string; name: string; payableMinor: number }> }) {
  const [picked, setPicked] = useState<string[]>(childrenDue.filter((child) => child.payableMinor > 0).map((child) => child.id));
  const chosen = childrenDue.filter((child) => picked.includes(child.id));
  const total = chosen.reduce((sum, child) => sum + child.payableMinor, 0);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {childrenDue.map((child) => (
          <li key={child.id}>
            <label className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={picked.includes(child.id)}
                disabled={child.payableMinor === 0}
                onChange={(event) => setPicked((current) => (event.target.checked ? [...current, child.id] : current.filter((id) => id !== child.id)))}
              />
              <span className="flex-1 font-medium">{child.name}</span>
              <span className="tabular-nums">{rupees(child.payableMinor)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="bg-primary-soft text-primary-strong rounded-xl px-4 py-3 text-sm">
        Pay together: <strong className="tabular-nums">{rupees(total)}</strong>
        {chosen.length > 1 ? ` (${chosen.map((child) => `${child.name.split(" ")[0]} ${rupees(child.payableMinor)}`).join(" + ")})` : ""}. Pay this at the school&apos;s fee desk —
        it is recorded as one family payment, with each child&apos;s share on their own account.
      </p>
    </div>
  );
}

