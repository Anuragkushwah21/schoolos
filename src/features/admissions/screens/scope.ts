/**
 * Who is using an admissions screen: the School Admin under
 * /school-admin/admissions, or front-desk staff under /staff with their own
 * permissions. The screens are the same; links follow `base`, and controls a
 * person may not use are not shown — the services refuse them regardless.
 */
export type DeskScope = {
  /** Where this list lives: "/school-admin/admissions/enquiries" or "/staff/enquiries". */
  base: string;
  /** The School Admin: conversion, concessions, archive and the admissions tabs. */
  admin: boolean;
  /** Add, edit, follow up and change status. */
  canManage: boolean;
  /** Discuss fees and discounts. */
  canFees: boolean;
};

export const ADMIN_ENQUIRY_SCOPE: DeskScope = { base: "/school-admin/admissions/enquiries", admin: true, canManage: true, canFees: true };
export const ADMIN_APPLICATION_SCOPE: DeskScope = { base: "/school-admin/admissions", admin: true, canManage: true, canFees: true };

/** Front-desk staff: what their own permissions allow on these screens. */
export function staffScope(base: string, grants: readonly string[], manage: "enquiries.manage" | "admissions.manage"): DeskScope {
  return { base, admin: false, canManage: grants.includes(manage), canFees: grants.includes("enquiries.fees") };
}
