# Alignment audit — 25 Sep 2026

What the repository contained when measured against the final product direction
(School Operations + Parent Engagement SaaS), what was changed to align it, and
what is deliberately still open.

Read [`PROJECT.md`](PROJECT.md) first for how the system works; this file only
records the gap between that and the intended product.

---

## 1. Status by area

| Area | State | Note |
| --- | --- | --- |
| Multi-tenancy (one app, one database, many schools) | **DONE** | Scoped Prisma client plus composite foreign keys on `(schoolId, parentId)`. No tenant-role input schema accepts a `schoolId`. |
| Tenant isolation against forged ids | **DONE** | Verified across every write path; the only client-supplied `schoolId` is on Super Admin endpoints, where acting across schools is the role. |
| Role hierarchy and RBAC | **DONE** | `SUPER_ADMIN → SCHOOL_ADMIN → TEACHER → PARENT`, asserted in the data layer rather than the screens. |
| Single login, role-based routing | **WAS PARTIAL → DONE** | Three of the four dashboard paths did not match the direction. Renamed; see §2. |
| Parent as a real authenticated role | **DONE** | The role, model and pages existed; the landing route and the invite-only guarantee did not hold. See §4. |
| Parent = one login, many children | **DONE** | `User → Parent → ParentStudent → Student`. One parent row per person; siblings share it. Now covered by a test. |
| Student portal | **DONE** | Student sign-in, a daily dashboard, lessons with notes and material, homework, marks, attendance and remarks — all read-only, all from source rows. |
| Academic structure Nursery→12, configurable streams | **DONE** | `AcademicSession → Class → Stream? → Section → Student`. Streams are rows, not an enum. |
| Historical academic records | **DONE** | `StudentEnrollment` is one row per session; promotion inserts, never overwrites. |
| Student fields and filters | **DONE** | Every field in the direction exists. Filters cover name, admission and roll number, session, class, section, stream, gender and status. |
| Source data → reports (no duplicate entry) | **DONE** | One register powers the admin report, the analytics charts and the parent view. No per-student daily report document exists, by design. |
| Attendance (student and staff) | **DONE** | Duplicate marking is refused by a unique index on `(schoolId, studentId, date)`, not by application logic. |
| Timetable conflict prevention | **DONE** | Teacher double-booking and section overlap both refused, with tests. |
| Class activity | **PARTIAL** | Recorded on `ClassSession` against a timetable period. See §6 for the two deliberate deviations from the field list in the direction. |
| Class continuity / substitutes | **WAS MISSING → PARTIAL** | A School Admin can now assign cover and a stand-in can record the class. Surfacing a covered period in the substitute's own screens is still open. |
| Homework | **DONE** | One model, reused. Set by a teacher, read by the parent portal. |
| Teacher remarks | **WAS OUTDATED → DONE** | Was one free-text field. Now three structured bands plus an optional note. |
| Tests and marks | **PARTIAL** | `Assessment` + `AssessmentResult` are read end to end by both portals. Nothing writes them outside the demo seed — see §9. |
| Notices and events | **DONE** | School-wide, audience-scoped, no advertising surface. |
| Public school website / profile pages | **OUTDATED — kept, not removed** | Out of scope for the product but working and depended upon. See §7. |
| Public admissions intake | **OUTDATED (partly) — kept** | The admin review side is legitimate and stays. Only the public intake form conflicts. See §7. |
| Internal link safety | **WAS BROKEN → DONE** | Links were untyped strings; a renamed route left silent 404s. `typedRoutes` is now on. |
| Error boundaries | **MISSING** | No `error.tsx` anywhere in `src/app`, so a thrown `AppError` reaches Next's default screen. Unchanged here; see §9. |

---

## 2. Role-based routing

The direction fixes one dashboard per role. Three did not match:

| Role | Was | Now |
| --- | --- | --- |
| `SUPER_ADMIN` | `/platform` | `/super-admin/dashboard` |
| `SCHOOL_ADMIN` | `/admin` | `/school-admin/dashboard` |
| `TEACHER` | `/teacher/dashboard` | unchanged |
| `PARENT` | `/parent` | `/parent/dashboard` |

`STUDENT` stays at `/student`: student sign-in is not part of V1, and giving it a
`/dashboard` page would imply it is.

Each area also has an index route that redirects to its dashboard, so a
bookmarked `/school-admin` does not 404.

**How this was made safe.** Before moving anything, `typedRoutes` was enabled in
`next.config.ts`. Next then generates a union of the app's real routes and
`tsc` rejects a link to one that does not exist. Renaming became a compiler-checked
change rather than a grep: the compiler found the one link that the sweep missed
(the parent dashboard in `nav.ts`). Twenty pieces of shared plumbing that took
`href: string` now take `href: Route`, which is what makes that check reach them.

---

## 3. Authorization audit

Every exported server function was checked for a role assertion of its own,
because a Server Action is a public endpoint and the page that renders its form
protects nothing.

Two writes were reachable without an assertion of their own:

* `setPortalUserActive` — enables or disables a login. Protected only by which
  function happened to call it.
* `grantParentPortal` — issues a parent login. Protected only by the nested
  `createPortalUser`.

Both now assert `SCHOOL_ADMIN` directly. Neither was exploitable through any
existing route; both were one careless caller away from being so.

The remaining unasserted exports are tenant-scoped reads any member of a school
may perform (subject lists, section options, notices). They cannot cross a
tenant boundary, because `ctx.db` is scoped before they run.

**One known weakness, unchanged:** a few read helpers — `studentHistory`,
`getSectionWeek`, `getSectionTimetable` — take an id and trust that the caller
resolved it. Every current caller does, but the contract lives in the callers
rather than in the function, which is the opposite of how the rest of the data
layer works.

The parent portal deliberately did **not** add callers to them. `server/parent/`
has its own reads, and every one begins by re-resolving the child through
`requireChild`, so authorization is inside each function rather than assumed of
whoever calls it. The three older helpers are now the only ones left with the
weaker contract.

---

## 4. Parent architecture

The shape the direction asks for already existed:

```
User ──1:1── Parent ──ParentStudent──< Student
```

One `Parent` row per person, linked to any number of children, so a guardian
with three children signs in once and sees three. What did not hold:

* **Landing route** — `/parent` rather than `/parent/dashboard`. Fixed.
* **Invite-only** — true in practice (only a School Admin can reach
  `grantParentPortal`) but not asserted in the function. Fixed.
* **No second login per child** — enforced by `Parent.userId` being unique and
  the function refusing a parent who already has one. Now tested.

"Guardian" and "Parent" were two names for one concept. The user-facing noun is
now **Parent** throughout. `GUARDIAN` survives only as a *relationship* value
next to `FATHER` and `MOTHER`, which is a different question and a real one.

The portal itself is now built; §8 describes it.

---

## 5. Structured remarks

`StudentRemark` was a single free-text `body`. A parent reading a year of those
gets a different shape of sentence from every teacher.

It now answers three fixed questions, each optional:

| Field | Values |
| --- | --- |
| `understanding` | `GOOD` · `AVERAGE` · `NEEDS_ATTENTION` |
| `homeworkHabit` | `REGULAR` · `SOMETIMES_MISSING` · `FREQUENTLY_MISSING` |
| `participation` | `ACTIVE` · `AVERAGE` · `NEEDS_IMPROVEMENT` |
| `body` | the teacher's own words, now optional |

At least one of the four must be present — checked in the schema *and* in the
service, because the service is also reachable from the API. Existing rows keep
their text and answer none of the three, which is exactly what they were.

---

## 6. Class activity — two deliberate deviations

The direction lists `classId`, `sectionId`, `streamId`, `subjectId` and a
nullable `timetableId` on the activity record. The existing model instead hangs
the activity off `TimetableSlot`, which already names all four.

Kept as it is, because the indirection is the authorization: a teacher cannot
file an activity against a class they do not teach, since the only way in is a
period that already names them. Denormalising those columns would create a
second, weaker path to the same rows.

The consequence, accepted: **an activity cannot be recorded for a class that is
not on the timetable.** If ad-hoc periods are needed, that is the change to make,
and it wants its own columns and its own access check.

---

## 7. Out-of-scope features — found, not removed

The public school website conflicts with the product direction ("not a school
website builder", "not a public school profile platform"). It was **not** removed,
because the direction also says to determine what depends on something first,
and something does:

| Surface | Files | Depended on by |
| --- | --- | --- |
| Public school site | `(public)/schools/[slug]/**` (6 pages), `server/website/{public,admin}.ts` | — |
| Its editor | `school-admin/website/**` (3 pages) | — |
| Its models | `SchoolPage`, `SchoolMedia` | the editor |
| Public API | `api/v1/public/schools/[slug]/**` (6 routes) | — |
| **Public admissions intake** | `(public)/schools/[slug]/admissions`, `api/v1/public/schools/[slug]/applications` | **the admin's admissions review, which is in scope** |

The last row is the reason this is a decision and not a cleanup: removing the
public intake removes the only way an `AdmissionApplication` is created, and the
School Admin's review screens — which the direction explicitly wants kept — have
nothing to review without it. Admissions would need an internal "add an enquiry"
form first.

There is **no** school directory, no browse or search across schools, and no
public school list endpoint — so the marketplace concern does not apply. The
marketing site at `/` sells the product to schools; it is the platform's own
front door, not a school profile.

Recommended order if these go: the website editor and public pages first, the
two models with them, and the public admissions intake only after an internal
enquiry form exists.

---

## 8. The parent portal

One server module, `src/server/parent/`, owns every read the portal makes:

| File | What it holds |
| --- | --- |
| `access.ts` | `requireParentSelf`, `findChild`, `requireChild`, `listMyChildren` — the only door to a child |
| `child.ts` | today, attendance, timetable, activity, homework, results, remarks, report, focus |
| `alerts.ts` | what a guardian should be told without going looking |

**The chain that makes it safe** is the same in all of them and takes no id from
the caller except the `studentId` being asked for:

```
session user id -> Parent row -> ParentStudent link -> Student -> current enrollment
```

Nothing accepts a `parentId`, a `sectionId` or a `schoolId` from a request. The
section every read is scoped to is read off the enrollment row, so a guardian
cannot widen a read by naming a different section. Another family's child,
another school's child and a made-up id all answer `404`, so walking ids reveals
nothing about who else the school teaches.

**Nothing is duplicated.** There is no parent-shaped copy of attendance,
homework, activity, marks or remarks — the portal reads the operational rows the
school already works from, which is why a parent's figure cannot drift from the
register. A test asserts that no `parent*`/`child*` copy of those tables exists.

**Reports and alerts are derived, never stored.** A report is assembled from
those same rows on each read, so no teacher writes a report for a parent and
nothing can disagree with its source. Alerts are recomputed too: there is no
notification table to go stale.

**Home preparation is deterministic.** Five rules, each pointing at one recorded
row — the next due date, the weakest subject with at least two marks, the most
recent topic taught, a missed class, low attendance. No model, no external
dependency, and every line names the record it came from so a parent can check
it. The shape is what a richer version would slot into.

---

## 9. Remaining work

Ordered by what blocks the most.

1. **Marks entry for teachers.** The parent and student portals read
   `Assessment` and `AssessmentResult` end to end, but only the demo seed writes
   them. A teacher screen to create a test and enter a section's marks closes
   the last link in the chain.
2. **Surface covered periods to the substitute.** A stand-in can record a class
   and read it back, but their own day plan and week are built from
   `teacherId` on the timetable, so a covered period does not appear in either.
   The authorization is done; the screens are not.
3. **Assessments beyond the schema.** `Assessment` and `AssessmentResult` have no
   service, no validation and no UI.
4. **Error boundaries.** No `error.tsx` exists in `src/app`, although
   `lib/errors.ts` documents a boundary that shows `AppError.message`. Every
   thrown conflict — a plan limit, a refused delete — currently reaches Next's
   default error screen.
5. **Move the id-trusting read helpers' checks into the functions** (§3).
6. **Decide on the public website** (§7).
7. **Homework and class records for students and parents** — stored, published,
   and read by nobody yet.
