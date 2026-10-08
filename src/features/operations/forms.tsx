"use client";

import { useState } from "react";

import { ActionForm } from "@/components/forms/action-form";
import { CheckboxField, FieldRow, PhoneField, SelectField, SubmitButton, TextField, TextareaField } from "@/components/forms/fields";
import { humanize } from "@/lib/format";
import {
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  BORROWER_KINDS,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from "@/lib/validation/operations";

import {
  addStopAction,
  assignRouteCrewAction,
  moveRouteCrewAction,
  grantStaffPortalAction,
  issueBookAction,
  renewLoanAction,
  returnBookAction,
  saveAssetAction,
  saveBookAction,
  saveLibraryRulesAction,
  saveRouteAction,
  saveStaffAction,
  saveVehicleAction,
} from "./actions";

type Option = { value: string; label: string };
const opts = (values: readonly string[]) => values.map((value) => ({ value, label: humanize(value) }));

// --- staff -----------------------------------------------------------------------

/**
 * A staff member's details and role. What they may do starts from the role's
 * default permissions and is changed on their profile's Access tab — not
 * here, so this form stays short.
 */
export function StaffForm({
  staff,
  roles,
}: {
  staff?: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
    roleProfileId: string | null;
    designation: string | null;
    department: string | null;
    phone: string | null;
    email: string | null;
    joiningDate: string;
    status: string;
    notes: string | null;
    dateOfBirth?: string;
    gender?: string | null;
    addressLine?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    experienceYears?: number | null;
    employmentType?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  };
  /** Role profiles: built-in and the school's own. */
  roles: Array<{ value: string; label: string }>;
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
        {staff ? (
          // A role change has its own choice (keep custom permissions or reset) under Role & access.
          <div className="flex flex-col gap-1 text-sm">
            <input type="hidden" name="roleProfileId" value={staff.roleProfileId ?? ""} />
            <span className="font-medium">Role</span>
            <span className="text-muted-foreground">{roles.find((role) => role.value === staff.roleProfileId)?.label ?? "—"} · change it under Role &amp; access</span>
          </div>
        ) : (
          <SelectField name="roleProfileId" label="Role" options={roles} placeholder="Choose" hint="They start with this role's default permissions." required />
        )}
      </FieldRow>
      <FieldRow>
        <TextField name="designation" label="Job title" placeholder="Senior accountant" defaultValue={staff?.designation ?? ""} />
        <TextField name="department" label="Department" placeholder="Accounts" defaultValue={staff?.department ?? ""} />
      </FieldRow>
      <FieldRow>
        <PhoneField name="phone" label="Mobile" defaultValue={staff?.phone ?? ""} />
        <TextField name="email" label="Email" type="email" defaultValue={staff?.email ?? ""} />
      </FieldRow>
      <FieldRow>
        <TextField name="joiningDate" label="Joining date" type="date" defaultValue={staff?.joiningDate} hint="May be a future date for someone starting soon." />
        {/* New staff start Active; later changes use "Change status" on their page. */}
        <div />
      </FieldRow>
      {staff ? (
        <>
          <FieldRow>
            <TextField name="dateOfBirth" label="Date of birth" type="date" defaultValue={staff.dateOfBirth ?? ""} />
            <SelectField
              name="gender"
              label="Gender"
              options={[
                { value: "MALE", label: "Male" },
                { value: "FEMALE", label: "Female" },
                { value: "OTHER", label: "Other" },
              ]}
              defaultValue={staff.gender ?? ""}
              placeholder="—"
            />
          </FieldRow>
          <TextField name="addressLine" label="Address" defaultValue={staff.addressLine ?? ""} />
          <FieldRow>
            <TextField name="city" label="City" defaultValue={staff.city ?? ""} />
            <TextField name="state" label="State" defaultValue={staff.state ?? ""} />
            <TextField name="postalCode" label="PIN code" defaultValue={staff.postalCode ?? ""} />
          </FieldRow>
          <FieldRow>
            <SelectField
              name="employmentType"
              label="Employment type"
              options={[
                { value: "FULL_TIME", label: "Full time" },
                { value: "PART_TIME", label: "Part time" },
                { value: "CONTRACT", label: "Contract" },
                { value: "TEMPORARY", label: "Temporary" },
                { value: "VOLUNTEER", label: "Volunteer" },
              ]}
              defaultValue={staff.employmentType ?? ""}
              placeholder="—"
            />
            <TextField name="experienceYears" label="Experience (years)" type="number" min={0} max={60} defaultValue={staff.experienceYears ?? ""} />
          </FieldRow>
          <FieldRow>
            <TextField name="emergencyContactName" label="Emergency contact" defaultValue={staff.emergencyContactName ?? ""} />
            <PhoneField name="emergencyContactPhone" label="Emergency contact mobile" defaultValue={staff.emergencyContactPhone ?? ""} />
          </FieldRow>
        </>
      ) : null}
      <TextareaField name="notes" label="Notes" rows={2} defaultValue={staff?.notes ?? ""} />
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
  defaults,
}: {
  /** A new route started from someone's profile: they are already in the driver's or attendant's seat. */
  defaults?: { driverId?: string; attendantId?: string };
  route?: {
    id: string;
    name: string;
    code: string | null;
    startPoint: string | null;
    endPoint: string | null;
    vehicleId: string | null;
    driverId: string | null;
    attendantId: string | null;
    isActive: boolean;
    notes: string | null;
  };
  vehicles: Option[];
  drivers: Option[];
  attendants: Option[];
}) {
  return (
    <ActionForm action={saveRouteAction} resetOnSuccess={!route} className="gap-3">
      {route ? <input type="hidden" name="routeId" value={route.id} /> : null}
      <FieldRow>
        <TextField name="name" label="Route name" defaultValue={route?.name} placeholder="Vijay Nagar" required />
        <TextField name="code" label="Route number" defaultValue={route?.code ?? ""} placeholder="R-3" hint="Optional — as painted on the bus." />
      </FieldRow>
      <FieldRow>
        <TextField name="startPoint" label="Start point" defaultValue={route?.startPoint ?? ""} placeholder="Vijay Nagar depot" />
        <TextField name="endPoint" label="End point" defaultValue={route?.endPoint ?? ""} placeholder="School main gate" />
      </FieldRow>
      <SelectField name="vehicleId" label="Vehicle" options={vehicles} defaultValue={route?.vehicleId ?? undefined} placeholder="None" />
      <FieldRow>
        <SelectField name="driverId" label="Driver" options={drivers} defaultValue={route?.driverId ?? defaults?.driverId} placeholder="None" hint="Staff with the Driver designation." />
        <SelectField name="attendantId" label="Attendant" options={attendants} defaultValue={route?.attendantId ?? defaults?.attendantId} placeholder="None" />
      </FieldRow>
      <TextareaField name="notes" label="Notes for the driver" rows={2} defaultValue={route?.notes ?? ""} />
      <CheckboxField name="isActive" label="Running" defaultChecked={route?.isActive ?? true} />
      <div>
        <SubmitButton size="sm">{route ? "Save route" : "Create route"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Put this driver or attendant on a route (whoever had the seat is replaced). */
export function AssignCrewForm({ staffId, as, routes }: { staffId: string; as: "DRIVER" | "ATTENDANT"; routes: Option[] }) {
  return (
    <ActionForm action={assignRouteCrewAction} className="gap-3">
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="as" value={as} />
      <SelectField name="routeId" label="Route" options={routes} placeholder="Choose a route" required hint="If the route already has a driver, they are replaced." />
      <div>
        <SubmitButton size="sm">Assign to route</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Move this driver or attendant from one route to another in one step. */
export function MoveCrewForm({ staffId, fromRouteId, routes }: { staffId: string; fromRouteId: string; routes: Option[] }) {
  return (
    <ActionForm action={moveRouteCrewAction} className="flex-row flex-wrap items-end gap-2">
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="fromRouteId" value={fromRouteId} />
      <SelectField name="toRouteId" label="Move to another route" options={routes} placeholder="Choose a route" required className="min-w-56 flex-1" />
      <SubmitButton size="sm" variant="outline" pendingLabel="Moving…">
        Move
      </SubmitButton>
    </ActionForm>
  );
}

/** Add a stop, or edit one when `stop` is given. Stops are optional. */
export function StopForm({
  routeId,
  nextSequence,
  stop,
}: {
  routeId: string;
  nextSequence: number;
  stop?: { id: string; name: string; location: string | null; sequence: number; pickupTime: string; dropTime: string };
}) {
  return (
    <ActionForm action={addStopAction} resetOnSuccess={!stop} className="gap-3">
      <input type="hidden" name="routeId" value={routeId} />
      {stop ? <input type="hidden" name="stopId" value={stop.id} /> : null}
      <FieldRow>
        <TextField name="name" label="Stop name" defaultValue={stop?.name} required />
        <TextField name="sequence" label="Order" type="number" min={1} defaultValue={stop?.sequence ?? nextSequence} required />
      </FieldRow>
      <TextField name="location" label="Landmark / location" defaultValue={stop?.location ?? ""} placeholder="Near the post office, Sector 4" />
      <FieldRow>
        <TextField name="pickupMinute" label="Pickup" type="time" defaultValue={stop?.pickupTime ?? ""} />
        <TextField name="dropMinute" label="Drop" type="time" defaultValue={stop?.dropTime ?? ""} />
      </FieldRow>
      <div>
        <SubmitButton size="sm">{stop ? "Save stop" : "Add stop"}</SubmitButton>
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

type Borrower = { kind: "STUDENT" | "TEACHER" | "STAFF"; id: string; name: string; code: string; detail: string; booksOut: number };

/**
 * Find who is borrowing by name, admission no. or employee ID. Results come
 * from `/api/v1/library/borrowers`, which returns only what the desk needs —
 * never a parent's phone, fees or marks.
 */
function BorrowerPicker({ onPick }: { onPick: (borrower: Borrower) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Borrower[]>([]);
  const [busy, setBusy] = useState(false);

  async function search(term: string) {
    setQ(term);
    if (term.trim().length < 2) {
      setHits([]);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/library/borrowers?q=${encodeURIComponent(term.trim())}`, { cache: "no-store" });
      setHits(response.ok ? ((await response.json()) as { data: Borrower[] }).data : []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" htmlFor="borrower-search">
        Find the borrower
      </label>
      <input
        id="borrower-search"
        type="search"
        value={q}
        onChange={(event) => void search(event.target.value)}
        placeholder="Student name, admission no. or employee ID"
        className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
        autoComplete="off"
      />
      {q.trim().length >= 2 ? (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-sm">
          {busy && !hits.length ? <li className="text-muted-foreground px-3 py-2">Searching…</li> : null}
          {!busy && !hits.length ? <li className="text-muted-foreground px-3 py-2">No current student, teacher or staff member matches.</li> : null}
          {hits.map((hit) => (
            <li key={`${hit.kind}-${hit.id}`}>
              <button
                type="button"
                className="hover:bg-muted flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                onClick={() => {
                  onPick(hit);
                  setQ("");
                  setHits([]);
                }}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{hit.name}</span>
                  <span className="text-muted-foreground block text-xs">
                    {hit.code} · {hit.detail}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">{hit.booksOut ? `${hit.booksOut} out` : "no books out"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Issue Book: find the student (name, admission no., class "9-A" or stream),
 * choose the book, then one of its copies on the shelf. Issued today; due by
 * the school's loan period unless changed. Everything is checked again on the
 * server, including that the copy is still free.
 */
export function IssueBookForm({ books, today, defaultDue }: { books: Array<Option & { copies: Option[] }>; today: string; defaultDue: string }) {
  const [kind, setKind] = useState<string>("STUDENT");
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<Borrower | null>(null);
  const [bookId, setBookId] = useState("");
  const copies = books.find((book) => book.value === bookId)?.copies ?? [];
  return (
    <ActionForm action={issueBookAction} resetOnSuccess className="gap-3">
      <BorrowerPicker
        onPick={(borrower) => {
          setPicked(borrower);
          setKind(borrower.kind);
          setCode(borrower.code);
        }}
      />
      {picked ? (
        <p className="bg-primary-soft text-primary-strong rounded-md px-3 py-2 text-sm">
          <span className="font-semibold">{picked.name}</span>
          <span className="block text-xs">
            {picked.code} · {picked.detail}
            {picked.booksOut ? ` · already has ${picked.booksOut} book${picked.booksOut === 1 ? "" : "s"}` : ""}
          </span>
        </p>
      ) : null}
      <input type="hidden" name="studentId" value={picked?.kind === "STUDENT" && picked.code === code ? picked.id : ""} />
      <details className="text-sm" open={!picked && code !== ""}>
        <summary className="text-muted-foreground cursor-pointer text-xs">Enter an admission no. or employee ID instead</summary>
        <FieldRow>
          <SelectField name="borrowerKind" label="Borrower" options={opts(BORROWER_KINDS)} value={kind} onChange={(event) => setKind(event.target.value)} required />
          <TextField name="borrowerCode" label="Admission no. / employee ID" value={code} onChange={(event) => setCode(event.target.value)} />
        </FieldRow>
      </details>
      <SelectField
        name="bookId"
        label="Book"
        options={books.map(({ value, label }) => ({ value, label }))}
        placeholder={books.length ? "Choose a book" : "No copy is on the shelf"}
        value={bookId}
        onChange={(event) => setBookId(event.target.value)}
        required
      />
      <SelectField key={bookId} name="copyId" label="Book copy" options={copies} defaultValue={copies[0]?.value} placeholder={bookId ? "Choose an available copy" : "Choose a book first"} required />
      <input type="hidden" name="issuedOn" value={today} />
      <FieldRow>
        <p className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Issue date</span>
          <span className="text-muted-foreground">Today ({today.split("-").reverse().join("/")})</span>
        </p>
        <TextField name="dueOn" label="Due date" type="date" defaultValue={defaultDue} min={today} required />
      </FieldRow>
      <div>
        <SubmitButton pendingLabel="Issuing…">Issue Book</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** A new due date for a book still out. */
export function RenewLoanForm({ issueId, currentDue }: { issueId: string; currentDue: string }) {
  return (
    <ActionForm action={renewLoanAction} className="flex-row flex-wrap items-center gap-2">
      <input type="hidden" name="issueId" value={issueId} />
      <input type="date" name="dueOn" min={currentDue} required aria-label="New due date" className="border-input h-8 rounded-md border px-2 text-sm" />
      <SubmitButton size="xs" variant="ghost">
        Renew
      </SubmitButton>
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

/** School Admin: the library's lending rules. */
export function LibraryRulesForm({ rules }: { rules: { loanDays: number; maxLoans: number; finePerDayMinor: number } }) {
  return (
    <ActionForm action={saveLibraryRulesAction} className="gap-3">
      <FieldRow>
        <TextField name="loanDays" label="Loan period (days)" type="number" min={1} max={60} defaultValue={String(rules.loanDays)} required />
        <TextField name="maxLoans" label="Books per borrower" type="number" min={1} max={20} defaultValue={String(rules.maxLoans)} required />
      </FieldRow>
      <TextField name="finePerDayRupees" label="Fine per late day (₹)" type="number" min={0} step="1" defaultValue={String(rules.finePerDayMinor / 100)} hint="0 means no fines." required />
      <div>
        <SubmitButton variant="outline" size="sm">
          Save library rules
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
