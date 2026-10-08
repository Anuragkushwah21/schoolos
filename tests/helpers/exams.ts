import type { TenantContext } from "@/server/auth/current-user";
import { getExamDetail, submitMarks, verifyExam } from "@/server/exams/service";

/** Submit every paper of an exam and verify it — what the office does before publishing. */
export async function submitAndVerify(admin: TenantContext, examId: string) {
  const detail = await getExamDetail(admin, examId);
  for (const paper of detail.papers) {
    await submitMarks(admin, paper.id).catch((error: Error) => {
      if (!/already submitted/.test(error.message)) throw error;
    });
  }
  await verifyExam(admin, examId);
}
