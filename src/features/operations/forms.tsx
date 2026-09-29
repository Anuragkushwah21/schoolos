"use client";

import { ActionForm } from "@/components/forms/action-form";
import { CheckboxField, FieldRow, SelectField, SubmitButton, TextareaField, TextField } from "@/components/forms/fields";
import { humanize } from "@/lib/format";
import {
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  BORROWER_KINDS,
  STAFF_PERMISSION_LABEL,
  STAFF_PERMISSIONS,
  STAFF_ROLES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from "@/lib/validation/operations";

import {
  addStopAction,
  grantStaffPortalAction,
  issueBookAction,
  returnBookAction,
  saveAssetAction,
  saveBookAction,
  saveRouteAction,
  saveStaffAction,
  saveVehicleAction,
} from "./actions";

type Option = { value: string; label: string };
const opts = (values: readonly string[]) => values.map((value) => ({ value, label: humanize(value) }));

// --- staff -----------------------------------------------------------------------

export function StaffForm({
  staff,
}: {
  staff?: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
    role: string;
    designation: string | null;
    department: string | null;
    phone: string | null;
    email: string | null;
    joiningDate: string;
    status: string;
    notes: string | null;
    permissions: string[];
  };
}) {
  return (
    <ActionForm action={saveStaffAction} resetOnSuccess={!staff} className="max-w-3xl">
      {staff ? <input type="hidden" name="staffId" value={staff.id} /> : null}
      <FieldRow>
        <TextField name="firstName" label="First name" defaultValue={staff?.firstName} required />
        <TextField name="lastName" label="Last name" defaultValue={staff?.lastName} required />
      </FieldRow>
      <FieldRow>
        <TextField name="employeeId" label="Employee ID" defaultValue={staff?.employeeId} required />
        <SelectField
          name="role"
          label="Designation"
          options={opts(STAFF_ROLES)}
          defaultValue={staff?.role}
          placeholder="Choose"
          hint="A designation grants no access by itself."
          required
        />
      </FieldRow>
      <FieldRow>
        <TextField name="designation" label="Job title" placeholder="Senior accountant" defaultValue={staff?.designation ?? ""} />
        <TextField name="department" label="Department" placeholder="Accounts" defaultValue={staff?.department ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="phone" label="Mobile" defaultValue={staff?.phone ?? ""} />
        <TextField name="email" label="Email" type="email" defaultValue={staff?.email ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="joiningDate" label="Joining date" type="date" defaultValue={staff?.joiningDate} hint="May be a future date for someone starting soon." />
        {/* New staff start Active; later changes use "Change status" on their page. */}
        <div />
      </FieldRow>
      <TextareaField name="notes" label="Notes" rows={2} defaultValue={staff?.notes ?? ""} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Portal access</legend>
        <p className="text-muted-foreground text-xs">
          With a login, every staff member sees their profile, staff notices and meetings they are invited to. Tick anything else they may open — all read-only.
        </p>
        {/* Sent even with nothing ticked, so removing the last permission is saved. */}
        <input type="hidden" name="permissions" value="" />
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          {STAFF_PERMISSIONS.map((permission) => (
            <label key={permission} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="permissions"
                value={permission}
                defaultChecked={staff?.permissions.includes(permission)}
                className="accent-primary mt-0.5 size-4 shrink-0"
              />
              <span>
                {STAFF_PERMISSION_LABEL[permission].label}
                <span className="text-muted-foreground block text-xs">{STAFF_PERMISSION_LABEL[permission].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <SubmitButton>{staff ? "Save" : "Add staff member"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function StaffLoginForm({ staffId, defaultEmail }: { staffId: string; defaultEmail?: string | null }) {
  return (
    <ActionForm action={grantStaffPortalAction} className="gap-3">
      <input type="hidden" name="personId" value={staffId} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField name="email" label="Login email" type="email" defaultValue={defaultEmail ?? ""} className="min-w-56 flex-1" required />
        <SubmitButton variant="outline" pendingLabel="Creating…">
          Create login
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

// --- transport -------------------------------------------------------------------

export function VehicleForm({ vehicle }: { vehicle?: { id: string; registrationNo: string; type: string; capacity: number; status: string; notes: string | null } }) {
  return (
    <ActionForm action={saveVehicleAction} resetOnSuccess={!vehicle} className="gap-3">
      {vehicle ? <input type="hidden" name="vehicleId" value={vehicle.id} /> : null}
      <FieldRow>
        <TextField name="registrationNo" label="Registration no." defaultValue={vehicle?.registrationNo} placeholder="MP09 AB 1234" required />
        <SelectField name="type" label="Type" options={opts(VEHICLE_TYPES)} defaultValue={vehicle?.type ?? "BUS"} required />
      </FieldRow>
      <FieldRow>
        <TextField name="capacity" label="Seats" type="number" min={1} max={120} defaultValue={vehicle?.capacity ?? 40} required />
        <SelectField name="status" label="Status" options={opts(VEHICLE_STATUSES)} defaultValue={vehicle?.status ?? "ACTIVE"} required />
      </FieldRow>
      <div>
        <SubmitButton size="sm">{vehicle ? "Save vehicle" : "Add vehicle"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RouteForm({
  route,
  vehicles,
  drivers,
  attendants,
}: {
  route?: { id: string; name: string; vehicleId: string | null; driverId: string | null; attendantId: string | null; isActive: boolean; notes: string | null };
  vehicles: Option[];
  drivers: Option[];
  attendants: Option[];
}) {
  return (
    <ActionForm action={saveRouteAction} resetOnSuccess={!route} className="gap-3">
      {route ? <input type="hidden" name="routeId" value={route.id} /> : null}
      <TextField name="name" label="Route name" defaultValue={route?.name} placeholder="Route 3 — Vijay Nagar" required />
      <SelectField name="vehicleId" label="Vehicle" options={vehicles} defaultValue={route?.vehicleId ?? undefined} placeholder="None" />
      <FieldRow>
        <SelectField name="driverId" label="Driver" options={drivers} defaultValue={route?.driverId ?? undefined} placeholder="None" />
        <SelectField name="attendantId" label="Attendant" options={attendants} defaultValue={route?.attendantId ?? undefined} placeholder="None" />
      </FieldRow>
      <CheckboxField name="isActive" label="Running" defaultChecked={route?.isActive ?? true} />
      <div>
        <SubmitButton size="sm">{route ? "Save route" : "Create route"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function StopForm({ routeId, nextSequence }: { routeId: string; nextSequence: number }) {
  return (
    <ActionForm action={addStopAction} resetOnSuccess className="gap-3">
      <input type="hidden" name="routeId" value={routeId} />
      <FieldRow>
        <TextField name="name" label="Stop" required />
        <TextField name="sequence" label="Order" type="number" min={1} defaultValue={nextSequence} required />
      </FieldRow>
      <FieldRow>
        <TextField name="pickupMinute" label="Pickup" type="time" />
        <TextField name="dropMinute" label="Drop" type="time" />
      </FieldRow>
      <div>
        <SubmitButton size="sm">Add stop</SubmitButton>
      </div>
    </ActionForm>
  );
}

// --- library ---------------------------------------------------------------------

export function BookForm({
  book,
}: {
  book?: { id: string; title: string; author: string | null; isbn: string | null; category: string | null; publisher: string | null; shelf: string | null; quantity: number; isActive: boolean };
}) {
  return (
    <ActionForm action={saveBookAction} resetOnSuccess={!book} className="gap-3">
      {book ? <input type="hidden" name="bookId" value={book.id} /> : null}
      <TextField name="title" label="Title" defaultValue={book?.title} required />
      <FieldRow>
        <TextField name="author" label="Author" defaultValue={book?.author ?? ""} />
        <TextField name="isbn" label="ISBN" defaultValue={book?.isbn ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="category" label="Category" defaultValue={book?.category ?? ""} placeholder="Fiction, Science…" />
        <TextField name="publisher" label="Publisher" defaultValue={book?.publisher ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="shelf" label="Shelf" defaultValue={book?.shelf ?? ""} />
        <TextField name="quantity" label="Copies" type="number" min={0} defaultValue={book?.quantity ?? 1} required />
      </FieldRow>
      <CheckboxField name="isActive" label="Available for lending" defaultChecked={book?.isActive ?? true} />
      <div>
        <SubmitButton size="sm">{book ? "Save book" : "Add book"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Issue a copy. Dates: issued today or up to 30 days back, due within 60 days — checked on the server too. */
export function IssueBookForm({ books, today, defaultDue }: { books: Option[]; today: string; defaultDue: string }) {
  return (
    <ActionForm action={issueBookAction} resetOnSuccess className="gap-3">
      <SelectField name="bookId" label="Book" options={books} placeholder="Choose a book with a free copy" required />
      <FieldRow>
        <SelectField name="borrowerKind" label="Borrower" options={opts(BORROWER_KINDS)} defaultValue="STUDENT" required />
        <TextField name="borrowerCode" label="Admission no. / employee ID" required />
      </FieldRow>
      <FieldRow>
        <TextField name="issuedOn" label="Issued on" type="date" defaultValue={today} max={today} required />
        <TextField name="dueOn" label="Due on" type="date" defaultValue={defaultDue} min={today} required />
      </FieldRow>
      <div>
        <SubmitButton size="sm">Issue</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ReturnBookForm({ issueId, today, issuedOn }: { issueId: string; today: string; issuedOn: string }) {
  return (
    <ActionForm action={returnBookAction} className="flex-row flex-wrap items-center gap-2">
      <input type="hidden" name="issueId" value={issueId} />
      <input type="date" name="returnedOn" defaultValue={today} min={issuedOn} max={today} aria-label="Returned on" className="border-input h-8 rounded-md border px-2 text-sm" />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" name="finePaid" className="accent-primary size-3.5" />
        Fine paid
      </label>
      <SubmitButton size="xs" variant="outline">
        Return
      </SubmitButton>
    </ActionForm>
  );
}

// --- inventory -------------------------------------------------------------------

export function AssetForm({
  asset,
  today,
}: {
  asset?: {
    id: string;
    code: string;
    name: string;
    category: string;
    purchaseDate: string;
    purchaseCost: string;
    quantity: number;
    location: string | null;
    assignedTo: string | null;
    condition: string;
    status: string;
    notes: string | null;
  };
  today: string;
}) {
  return (
    <ActionForm action={saveAssetAction} resetOnSuccess={!asset} className="gap-3">
      {asset ? <input type="hidden" name="assetId" value={asset.id} /> : null}
      <FieldRow>
        <TextField name="code" label="Asset code" defaultValue={asset?.code} placeholder="LAB-PC-014" required />
        <TextField name="name" label="Name" defaultValue={asset?.name} required />
      </FieldRow>
      <FieldRow>
        <SelectField name="category" label="Category" options={opts(ASSET_CATEGORIES)} defaultValue={asset?.category} placeholder="Choose" required />
        <TextField name="quantity" label="Quantity" type="number" min={1} defaultValue={asset?.quantity ?? 1} required />
      </FieldRow>
      <FieldRow>
        <TextField name="location" label="Location" defaultValue={asset?.location ?? ""} placeholder="Computer lab" />
        <TextField name="assignedTo" label="Assigned to" defaultValue={asset?.assignedTo ?? ""} placeholder="Person or department" />
      </FieldRow>
      <FieldRow>
        <SelectField name="condition" label="Condition" options={opts(ASSET_CONDITIONS)} defaultValue={asset?.condition ?? "GOOD"} required />
        <SelectField name="status" label="Status" options={opts(ASSET_STATUSES)} defaultValue={asset?.status ?? "ACTIVE"} required />
      </FieldRow>
      <FieldRow>
        <TextField name="purchaseDate" label="Purchased on" type="date" defaultValue={asset?.purchaseDate} max={today} />
        <TextField name="purchaseCostMinor" label="Cost (₹)" type="number" min={0} step="0.01" defaultValue={asset?.purchaseCost} />
      </FieldRow>
      <TextareaField name="notes" label="Notes" rows={2} defaultValue={asset?.notes ?? ""} />
      <div>
        <SubmitButton size="sm">{asset ? "Save asset" : "Add asset"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
