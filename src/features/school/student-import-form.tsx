"use client";

import { PreviewImportForm } from "@/features/imports/preview-import-form";

import { importStudentsAction } from "./bulk-student-actions";

/** Upload the filled template, check it, then import the valid rows. */
export function StudentImportForm() {
  return <PreviewImportForm action={importStudentsAction} noun="student" />;
}
