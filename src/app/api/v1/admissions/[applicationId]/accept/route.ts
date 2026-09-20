import { apiRoute, apiSuccess, readJson } from "@/server/api/handler";
import { acceptAdmissionSchema } from "@/lib/validation/website";
import { acceptApplication } from "@/server/admissions/service";
import { getStudentProfile } from "@/server/people/students";

/**
 * Accept: creates the student, their guardian and the enrollment in one
 * transaction. A guardian with the same phone is reused, so siblings share
 * one record.
 */
export const POST = apiRoute<{ applicationId: string }>(
  { roles: ["SCHOOL_ADMIN"] },
  async ({ request, ctx, params }) => {
    const input = await readJson(request, acceptAdmissionSchema, {
      applicationId: params.applicationId,
    });
    const { studentId } = await acceptApplication(ctx, input);
    const { student } = await getStudentProfile(ctx, studentId);
    return apiSuccess(student, { status: 201 });
  },
);
