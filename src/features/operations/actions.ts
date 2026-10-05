"use server";

import type { Route } from "next";
import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import {
  assetSchema,
  assetStatusSchema,
  assignTransportSchema,
  bookSchema,
  issueBookSchema,
  libraryRulesSchema,
  renewLoanSchema,
  returnBookSchema,
  routeSchema,
  staffSchema,
  stopSchema,
  vehicleSchema,
} from "@/lib/validation/operations";
import { portalAccessSchema } from "@/lib/validation/school";
import { requireTenantForAction } from "@/server/auth/current-user";
import { bulkAssetStatus, importAssets, saveAsset } from "@/server/operations/inventory";
import { importBooks, issueBook, markCopyCondition, markFinePaid, renewLoan, restoreCopy, returnBook, saveBook, saveLibraryRules } from "@/server/operations/library";
import { grantStaffPortal, importStaff, saveStaffDetails } from "@/server/operations/staff";
import { inviteMessage } from "@/server/auth/account-links";
import { emailMoveMessage } from "@/server/people/accounts";
import {
  addStop,
  assignRouteCrew,
  assignTransport,
  moveRouteCrew,
  removeRouteCrew,
  importTransport,
  removeStop,
  removeTransport,
  saveRoute,
  saveVehicle,
} from "@/server/operations/transport";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;
const PAGES = ["/school-admin", "/parent", "/student"];
const admin = () => requireTenantForAction("SCHOOL_ADMIN");
/** The library desk: the School Admin, or staff holding "Run the library" (checked in the service). */
const librarian = () => requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF");

export type ImportResult = ActionResult<undefined>;
type ImportError = { line: number; message: string };

/** Read the uploaded CSV, run the import, and turn row errors into a listed error. */
async function csvImport(formData: FormData, run: (text: string) => Promise<{ errors: ImportError[]; message: string }>): Promise<ImportResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose the CSV file to import." };
  if (file.size > 3_000_000) return { status: "error", message: "The file is too large." };
  const { errors, message } = await run(await file.text());
  if (errors.length) {
    return {
      status: "error",
      message: `Nothing was imported. Fix ${errors.length} row${errors.length === 1 ? "" : "s"} and try again.`,
      fieldErrors: Object.fromEntries(errors.map((error, index) => [`line ${error.line}#${index}`, [error.message]])),
    };
  }
  return successResult(message);
}

// --- staff ---------------------------------------------------------------------

export async function saveStaffAction(_p: ActionResult<{ id: string; created: boolean } | undefined>, formData: FormData): Promise<ActionResult<{ id: string; created: boolean } | undefined>> {
  return performAction(
    async () => {
      const input = parseFormData(staffSchema, formData);
      const { id, emailMove } = await saveStaffDetails(await admin(), input);
      return successResult(input.staffId ? `Staff member saved.${emailMoveMessage(emailMove)}` : "Staff member added. Give them a login below if they need one.", { id, created: !input.staffId });
    },
    // A new record opens on its own page, where the login is issued.
    { revalidate: [...PAGES, "/staff"], redirectTo: (data) => (data?.created ? (`/school-admin/staff/${data.id}` as Route) : ("/school-admin/staff" as Route)) },
  );
}

type CredentialsResult = ActionResult<undefined>;

export async function grantStaffPortalAction(_p: CredentialsResult, formData: FormData): Promise<CredentialsResult> {
  return performAction(
    async () => {
      const { personId, email } = parseFormData(portalAccessSchema, formData);
      const invite = await grantStaffPortal(await admin(), personId, email);
      return successResult(`Staff login created. ${inviteMessage(invite)}`);
    },
    { revalidate: PAGES },
  );
}

export async function importStaffAction(_p: ImportResult, formData: FormData): Promise<ImportResult> {
  return performAction(async () => {
    const ctx = await admin();
    return csvImport(formData, async (text) => {
      const result = await importStaff(ctx, text);
      return { errors: result.errors, message: `${result.created} staff added.` };
    });
  }, { revalidate: PAGES });
}

// --- transport -----------------------------------------------------------------

export async function saveVehicleAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await saveVehicle(await admin(), parseFormData(vehicleSchema, formData));
    return successResult("Vehicle saved.");
  }, { revalidate: PAGES });
}

export async function saveRouteAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await saveRoute(await admin(), parseFormData(routeSchema, formData));
    return successResult("Route saved.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function addStopAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const input = parseFormData(stopSchema, formData);
    await addStop(await admin(), input);
    return successResult(input.stopId ? "Stop saved." : "Stop added.");
  }, { revalidate: [...PAGES, "/staff"] });
}

const crewSchema = z.object({ routeId: id, staffId: id, as: z.enum(["DRIVER", "ATTENDANT"]) });

/** From a driver's or attendant's profile: put them on a route (replacing whoever had that seat). */
export async function assignRouteCrewAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { replaced } = await assignRouteCrew(await admin(), parseFormData(crewSchema, formData));
    return successResult(replaced ? `Assigned. ${replaced} is no longer on that route.` : "Assigned to the route.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function removeRouteCrewAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await removeRouteCrew(await admin(), parseFormData(z.object({ routeId: id, staffId: id }), formData));
    return successResult("Taken off the route.");
  }, { revalidate: [...PAGES, "/staff"] });
}

/** Move a driver or attendant to another route in one step. */
export async function moveRouteCrewAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { replaced } = await moveRouteCrew(await admin(), parseFormData(z.object({ staffId: id, fromRouteId: id, toRouteId: id }), formData));
    return successResult(replaced ? `Moved. ${replaced} is no longer on the new route.` : "Moved to the new route.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function removeStopAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { stopId } = parseFormData(z.object({ stopId: id }), formData);
    await removeStop(await admin(), stopId);
    return successResult("Stop removed.");
  }, { revalidate: PAGES });
}

export async function assignTransportAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { assigned } = await assignTransport(await admin(), parseFormData(assignTransportSchema, formData));
    return successResult(`${assigned} student${assigned === 1 ? "" : "s"} assigned.`);
  }, { revalidate: PAGES });
}

export async function removeTransportAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { studentId } = parseFormData(z.object({ studentId: id }), formData);
    await removeTransport(await admin(), studentId);
    return successResult("Taken off transport.");
  }, { revalidate: PAGES });
}

export async function importTransportAction(_p: ImportResult, formData: FormData): Promise<ImportResult> {
  return performAction(async () => {
    const ctx = await admin();
    return csvImport(formData, async (text) => {
      const result = await importTransport(ctx, text);
      return { errors: result.errors, message: `${result.assigned} students assigned to routes.` };
    });
  }, { revalidate: PAGES });
}

// --- library -------------------------------------------------------------------

export async function saveBookAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await saveBook(await librarian(), parseFormData(bookSchema, formData));
    return successResult("Book saved.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function issueBookAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { copyCode } = await issueBook(await librarian(), parseFormData(issueBookSchema, formData));
    return successResult(`Book Issued Successfully (copy ${copyCode}).`);
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function returnBookAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { fineMinor } = await returnBook(await librarian(), parseFormData(returnBookSchema, formData));
    return successResult(fineMinor ? `Returned late — fine ₹${(fineMinor / 100).toFixed(0)}.` : "Returned.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function renewLoanAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await renewLoan(await librarian(), parseFormData(renewLoanSchema, formData));
    return successResult("Loan renewed.");
  }, { revalidate: [...PAGES, "/staff"] });
}

/** School Admin: loan period, borrowing limit and fine rate. */
export async function saveLibraryRulesAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    await saveLibraryRules(await requireTenantForAction("SCHOOL_ADMIN"), parseFormData(libraryRulesSchema, formData));
    return successResult("Library rules saved.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function markFinePaidAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { issueId } = parseFormData(z.object({ issueId: id }), formData);
    await markFinePaid(await librarian(), issueId);
    return successResult("Fine marked as paid.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function importBooksAction(_p: ImportResult, formData: FormData): Promise<ImportResult> {
  return performAction(async () => {
    const ctx = await admin();
    return csvImport(formData, async (text) => {
      const result = await importBooks(ctx, text);
      return { errors: result.errors, message: `${result.created} titles added, ${result.updated} updated.` };
    });
  }, { revalidate: PAGES });
}

// --- inventory -----------------------------------------------------------------

export async function saveAssetAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    // The service checks "Manage inventory" for staff.
    await saveAsset(await requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF"), parseFormData(assetSchema, formData));
    return successResult("Asset saved.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function bulkAssetStatusAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { updated } = await bulkAssetStatus(await requireTenantForAction("SCHOOL_ADMIN", "NON_TEACHING_STAFF"), parseFormData(assetStatusSchema, formData));
    return successResult(`${updated} asset${updated === 1 ? "" : "s"} updated.`);
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function importAssetsAction(_p: ImportResult, formData: FormData): Promise<ImportResult> {
  return performAction(async () => {
    const ctx = await admin();
    return csvImport(formData, async (text) => {
      const result = await importAssets(ctx, text);
      return { errors: result.errors, message: `${result.created} assets added.` };
    });
  }, { revalidate: PAGES });
}

const copyConditionSchema = z.object({
  copyId: id,
  condition: z.enum(["LOST", "DAMAGED"], { error: "Choose lost or damaged" }),
  note: z.string().trim().min(3, "Say what happened").max(300),
  /** Optional replacement charge in rupees, for a lost book on loan. */
  chargeRupees: z.preprocess((value) => (value === "" || value === null ? undefined : value), z.coerce.number().int().min(0).max(100000).optional()),
});

export async function markCopyConditionAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const input = parseFormData(copyConditionSchema, formData);
    await markCopyCondition(await librarian(), { copyId: input.copyId, condition: input.condition, note: input.note, chargeMinor: input.chargeRupees ? input.chargeRupees * 100 : null });
    return successResult(input.condition === "LOST" ? "Copy marked lost and taken out of stock." : "Copy marked damaged and taken out of stock.");
  }, { revalidate: [...PAGES, "/staff"] });
}

export async function restoreCopyAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(async () => {
    const { copyId } = parseFormData(z.object({ copyId: id }), formData);
    await restoreCopy(await librarian(), copyId);
    return successResult("Copy back in stock.");
  }, { revalidate: [...PAGES, "/staff"] });
}
