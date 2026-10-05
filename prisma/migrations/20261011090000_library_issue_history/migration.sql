-- Library issue history: who processed a return and when, a separate
-- "damaged" ending, and the borrower's class on the day of issue.
-- Additive only: no column is dropped and no loan is deleted.

-- AlterTable
ALTER TABLE "BookIssue" ADD COLUMN     "borrowerGroup" TEXT,
ADD COLUMN     "damagedOn" DATE,
ADD COLUMN     "returnedAt" TIMESTAMP(3),
ADD COLUMN     "returnedById" TEXT;

-- AddForeignKey
ALTER TABLE "BookIssue" ADD CONSTRAINT "BookIssue_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Loans closed by "returned damaged" were stored as lost (lostOn) with a note
-- saying so. Give them their own ending; the date is unchanged.
UPDATE "BookIssue"
SET "damagedOn" = "lostOn", "lostOn" = NULL
WHERE "lostOn" IS NOT NULL AND "notes" LIKE 'Returned damaged:%';

-- Existing student loans: the class, section and stream the student was
-- placed in for the session that covers the issue date, where there is one.
-- Same format as the app's group label: "Class 5 – A" or "Class 11 – A • Science".
UPDATE "BookIssue" AS bi
SET "borrowerGroup" = c."name" || ' – ' || s."name" || COALESCE(' • ' || COALESCE(ss."name", es."name"), '')
FROM "StudentEnrollment" AS e
JOIN "AcademicSession" AS a ON a."id" = e."academicSessionId" AND a."schoolId" = e."schoolId"
JOIN "Section" AS s ON s."id" = e."sectionId" AND s."schoolId" = e."schoolId"
JOIN "Class" AS c ON c."id" = s."classId" AND c."schoolId" = s."schoolId"
LEFT JOIN "Stream" AS ss ON ss."id" = s."streamId"
LEFT JOIN "Stream" AS es ON es."id" = e."streamId"
WHERE bi."borrowerGroup" IS NULL
  AND bi."studentId" = e."studentId"
  AND bi."schoolId" = e."schoolId"
  AND bi."issuedOn" BETWEEN a."startDate" AND a."endDate";
