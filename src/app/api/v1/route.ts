import { NextResponse } from "next/server";

/**
 * The API index. Deliberately public and free of any school's data: it
 * describes the surface so a new client can find its way without a copy of
 * the docs, and reveals nothing about who is calling.
 */
export async function GET() {
  return NextResponse.json(
    {
      data: {
        name: "SchoolOS API",
        version: "v1",
        documentation: "/docs/API.md",
        authentication: {
          bearer: "Authorization: Bearer sos_… — a token created by a School Admin or Super Admin",
          session: "The browser session cookie, for same-origin calls from the app itself",
          note: "A token acts as the user who created it and can never exceed their role. READ tokens are refused on writes.",
        },
        endpoints: {
          account: ["GET /api/v1/me", "GET /api/v1/me/notices", "GET /api/v1/me/timetable", "GET /api/v1/me/attendance", "GET /api/v1/me/children", "GET /api/v1/me/children/{studentId}"],
          people: ["GET|POST /api/v1/students", "GET|PUT /api/v1/students/{id}", "POST /api/v1/students/{id}/enrollments", "POST /api/v1/students/{id}/guardians", "DELETE /api/v1/students/{id}/guardians/{linkId}", "POST /api/v1/students/{id}/portal-access", "GET /api/v1/guardians", "PUT /api/v1/guardians/{id}", "POST /api/v1/guardians/{id}/portal-access", "GET|POST /api/v1/teachers", "GET|PUT /api/v1/teachers/{id}", "POST /api/v1/teachers/{id}/assignments", "DELETE /api/v1/teachers/{id}/assignments/{assignmentId}"],
          academics: ["GET|POST /api/v1/academic-sessions", "POST /api/v1/academic-sessions/{id}/activate", "GET|POST /api/v1/classes", "PATCH /api/v1/classes/{id}", "GET|POST /api/v1/streams", "PATCH /api/v1/streams/{id}", "GET|POST /api/v1/subjects", "PATCH /api/v1/subjects/{id}", "GET|POST /api/v1/sections", "GET|PUT|DELETE /api/v1/sections/{id}"],
          operations: ["GET|POST /api/v1/timetable", "DELETE /api/v1/timetable/{slotId}", "GET|POST /api/v1/attendance", "GET|POST /api/v1/attendance/staff", "GET /api/v1/reports/attendance"],
          communication: ["GET|POST /api/v1/notices", "GET|PUT|DELETE /api/v1/notices/{id}", "GET|POST /api/v1/events", "GET|PUT|DELETE /api/v1/events/{id}"],
          admissions: ["GET /api/v1/admissions", "GET /api/v1/admissions/{id}", "POST /api/v1/admissions/{id}/status", "POST /api/v1/admissions/{id}/accept"],
          website: ["GET|PUT /api/v1/website/profile", "GET|POST /api/v1/website/pages", "GET|PUT|DELETE /api/v1/website/pages/{id}", "GET|POST /api/v1/website/media", "DELETE /api/v1/website/media/{id}"],
          tokens: ["GET|POST /api/v1/tokens", "DELETE /api/v1/tokens/{id}"],
          platform: ["GET /api/v1/platform/schools", "GET /api/v1/platform/schools/{id}", "POST /api/v1/platform/schools/{id}/transition", "POST /api/v1/platform/schools/{id}/admins", "PUT /api/v1/platform/schools/{id}/subscription", "POST /api/v1/platform/admins/{userId}/password", "POST /api/v1/platform/admins/{userId}/active", "GET /api/v1/platform/plans", "PUT /api/v1/platform/plans/{id}", "GET|POST /api/v1/platform/offers", "GET|PUT|DELETE /api/v1/platform/offers/{id}", "GET /api/v1/platform/audit"],
          public: ["GET /api/v1/public/schools/{slug}", "GET /api/v1/public/schools/{slug}/pages/{pageSlug}", "GET /api/v1/public/schools/{slug}/notices", "GET /api/v1/public/schools/{slug}/events", "GET /api/v1/public/schools/{slug}/admission-options", "POST /api/v1/public/schools/{slug}/applications", "POST /api/v1/public/registrations", "POST /api/v1/public/registrations/{reference}/verify", "POST /api/v1/public/registrations/{reference}/resend"],
        },
      },
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
