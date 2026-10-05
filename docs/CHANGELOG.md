# SchoolOS — Project log

A running record of what was asked for and what changed, newest first. Every
new request adds an entry here: what was asked, what changed, database
migrations (and whether they are on the live Neon database), how it was
tested, and anything left open.

How this fits with the other docs: [`PROJECT.md`](PROJECT.md) explains how the
system works today, [`ARCHITECTURE.md`](ARCHITECTURE.md) why it is built that
way, and [`API.md`](API.md) the REST endpoints. This file is the history.

---

## Current status

_Last updated: 5 Oct 2026 (Staff profile: everything at a glance; drivers' routes and stops managed from the profile)_

| | |
| --- | --- |
| Database migrations | 37 in `prisma/migrations`. **Check Neon with `npx prisma migrate status`.** On 4 Oct the live DB was missing `20261008090000`–`20261011090000`; **`20261012090000_routes_website_admissions` and `20261013090000_staff_roles_substitutes_trips` are NOT applied to Neon** — `npx prisma migrate deploy` applies whatever is pending, in order |
| Tests | 79 files, 832 tests passing; typecheck and lint clean; production build passing |
| Email | Code sends through Gmail SMTP when configured. **The Gmail App Password in `.env` was rejected by Gmail** — create a new App Password and put it in `SMTP_PASSWORD` |
| Uncommitted work | Everything in the 2 Oct and 3 Oct entries below (last commit `d611d70`) |

**Setup gaps on the live database** (not code bugs — features look broken until these are filled in):

- **Sankeswar** — all 7 sections have **no class teacher**; **0 subjects** assigned to teachers; no students yet. Without these, attendance registers have no owner, leave requests only the admin can approve, and every concern goes to the School Admin.
- **Green Valley Academy** — 9 of 13 sections have no class teacher.

**Known limits:** no online payment gateway (the parent "pay together" panel is a calculator; payment is recorded at the fee desk); the new admin dashboard and new exams/fees/admissions screens are English only (menus are Hindi/English); leave pages' body text is English only; timetable and homework are not split by stream; events have no audience field, so there is no bulk event visibility.

--- | --- |
| Database migrations | 31 in `prisma/migrations`. 30 applied to Neon (`20261006090000_rooms` confirmed applied 1 Oct 2026); **`20261007090000_notice_reads` is NOT applied yet** — run `npx prisma migrate deploy`. Until then the Notices pages and dashboards error on the live database |
| Tests | 62 files, 718 tests passing; lint clean; production build passing |
| Email | Code sends through Gmail SMTP when configured. **The Gmail App Password in `.env` was rejected by Gmail** — create a new App Password and put it in `SMTP_PASSWORD` |
| Uncommitted work | Everything since commit `d1118c8` (29 Sep) is not committed yet |

**Setup gaps on the live database** (not code bugs — features look broken until these are filled in):

- **Sankeswar** — all 7 sections have **no class teacher**; **0 subjects** assigned to teachers; no students yet. Without these, attendance registers have no owner, leave requests only the admin can approve, and every concern goes to the School Admin.
- **Green Valley Academy** — 9 of 13 sections have no class teacher.

**Known limits:** leave pages' body text is English only (menus are Hindi/English); timetable and homework are not split by stream (only concerns and support are); Class 6–8 leave uses the same rules as other classes but has no separate test.

---

## 5 Oct 2026 — Staff profile: see and change everything, routes from a driver's page

**Asked:** when the admin opens a staff member they should see all their information and be able to edit all of it. For a driver: their routes; if none, a way to add a route and stops; change route, add stops, send them to another route. Admin holds every staff permission.

**Changed (`src/app/(app)/school-admin/staff/[staffId]/page.tsx`):**

- **At a glance** card above the tabs: role (links to the role), employee ID, job title/department, mobile (tap to call), email, joined, today's attendance, login state, number of permissions, and routes — each links to the tab where it is changed. Editing stays in the tabs: Profile (details, status/archive, login, reset password), Role & access (every permission), Work & routes, Substitutes, Attendance & leave.
- **Work & routes** tab for drivers and attendants (and anyone on a route): each route as a card with start → end, vehicle, students, the other crew member;
  - **Move to another route** (one step: off this one, onto the chosen one in the same seat; the dropdown says who is on each route now and that they will be replaced),
  - **Remove from route**, link to the route's students,
  - **Stops**: list with edit and remove, **+ Add stop**,
  - **Edit route** (name, number, start/end point, vehicle, crew, running).
  - **Assign to a route** (an existing one) and **Create a new route** with them already filled in as driver/attendant — shown when they have no route, and as "Also assign" when they do.
- Server: `assignRouteCrew`, `removeRouteCrew`, `moveRouteCrew` in `src/server/operations/transport.ts` (School Admin only; only a Driver can drive and a Transport attendant attend; same school; move is one transaction; stops/students untouched; audited). Actions in `src/features/operations/actions.ts`; `AssignCrewForm`, `MoveCrewForm`, `RouteForm.defaults` in `src/features/operations/forms.tsx`.
- Route form labels "Start point" / "End point" (were "Starts at/Ends at", which read as times in Hindi). Place names used as examples ("Vijay Nagar") are kept untranslated so real route names are never translated.
- New interface text added to the Hindi dictionary (coverage test passes).

**Migrations:** none.

**Tested:** new `tests/integration/route-crew.test.ts` (assign driver and attendant, move with replacement and stops untouched, remove, wrong role / other school / non-admin refused). Full suite 832/832, typecheck, lint, production build. Rendered the driver's profile in headless Chrome (Hindi) against a seeded local DB: all sections present, no console errors. A click-through of Move / Add stop in the browser could not run (Chrome was no longer installed at that moment) — the same actions are covered by the integration tests.

---

## 5 Oct 2026 — Language switch translates everything

**Asked:** when someone changes the language, everything written anywhere on the screen must change.

**Before:** only text going through `t()` keys changed (menus, tabs, a few dashboards — ~48 of 586 component files). Most screens had their English written in place, so Hindi users saw mostly English.

**Changed:**

- **Phrase dictionary** `src/lib/i18n/phrases/hi.json`: Hindi for every piece of interface text in the source — 5,086 phrases and 1,117 templates with numbered holes ("Covering for {0} until {1}"), including humanized enum values (status badges), `pluralize()` counts, validation and server error messages. Translated with one glossary (consistent terms: छात्र, अभिभावक, उपस्थिति, फ़ीस, रूट …).
- **Engine** `src/lib/i18n/phrase-translate.ts`: exact match, templates (holes are translated too: "Status changed to Active"), "A · B" lists, trailing punctuation, spacing kept, English month/day names in dates → Hindi. Names, numbers and anything people typed are not in the dictionary and stay as written.
- **`AutoTranslate`** (`src/components/i18n/auto-translate.tsx`, mounted in the root layout when the language is not English): translates every visible text node and `placeholder` / `title` / `aria-label` / `alt` on every page — server pages, client components, toasts, form errors — and keeps doing so as the page changes. Only changes text values/attributes, never React's structure, and only after React has hydrated a node (no hydration errors). Skips inputs, textareas, code and `data-no-translate`. The page fades in once translated (fallback 2.5 s) so English does not flash. Switching back to English restores every original without a reload. The dictionary loads lazily, only for Hindi (~156 KB gzip, cached).
- **Extractor** `src/lib/i18n/phrase-extract.ts` + `npm run i18n:extract` (lists untranslated text in `scripts/i18n/missing-hi.json`) and `npm run i18n:merge <dir>`. **`tests/unit/phrase-coverage.test.ts` fails when any visible English in the source has no Hindi** — new screens cannot ship English-only.
- Fixed in passing: the student dashboard said "classs" (`pluralize(n, "class")`).
- The existing `t()` keys keep working unchanged.

**Migrations:** none.

**Tested:** unit tests for the engine and the coverage test; full suite 828/828; typecheck, lint, production build. In headless Chrome (Hindi) against a local seeded database: login, marketing home and contact, School Admin dashboard/staff/students/transport/admission form/payments, teacher dashboard and create test, parent dashboard and fees, student dashboard — all interface text Hindi, only data (names, school name, subject "English", event titles) left as entered, no console or hydration errors. Switching Hindi → English and English → Hindi from the language menu, without reload, changes the whole page including the sidebar.

**Open:** translations are machine-quality first drafts reviewed only by sampling — worth a read by a Hindi-speaking teacher; emails and PDFs/CSV exports are still English.

---

## 5 Oct 2026 — Teacher dashboard: class switcher and quick actions

**Asked:** redesign the teacher dashboard for quick work — create test, take attendance, today's classes — with a way to switch class, since a teacher teaches several. Keep what exists; fix what is missing.

**Already there:** today's registers (incl. cover), substitute periods, today's classes with Take attendance / Start class, stats, support, homework due, low-attendance list, trend, school life, alerts.

**Missing, now added (`src/app/(app)/teacher/dashboard/page.tsx`):**

- **Class switcher** — "All my classes" plus one pill per class (★ class teacher, dot when their register is still due). `?class=<sectionId>` scopes the whole page; only the teacher's own classes are offered and an unknown id just shows all (no access widened). A selected class shows a header card: students, subjects, register status, Open class.
- **Quick actions** for the chosen class: Take attendance (the register they owe), **Create test** (new), Set homework, Start class at the current/next period (or Enter marks when none left), View students, Add student support.
- **Today's classes** as a timeline with **Now** and **Next up** from the school clock (school time zone), time ranges, and clickable class names to switch.
- Registers, cover, stats, low attendance, homework due and the attendance trend all follow the chosen class. "Your classes" list links to each class's view.
- `/teacher/exams/new?section=` and `/teacher/homework/new?section=` pre-select that class (`ClassTestForm.sectionId`, `HomeworkForm.defaultSectionId`); `homeworkDueForMySections` takes an optional `sectionId` (ignored unless it is one of the teacher's own).
- New English/Hindi strings under `dashboard.teacher.*`.

**Migrations:** none.

**Tested:** typecheck, lint, full suite 821/821, production build (local DB). Not checked in a browser.

---

## 5 Oct 2026 — Non-teaching staff: roles, permissions, driver routes, substitutes

**Asked:** a complete non-teaching staff system: roles (Librarian, Driver, Accountant, Receptionist, Lab assistant, Security, Support staff, custom) without per-role hard-coded dashboards; module × action permissions (view/create/edit/delete/…) editable per role and per person; every API checking user, school, role, permission and assignment; drivers seeing only their route's students and marking pickup/drop; accountant access to fees/expenses/payroll as allowed; a reusable staff profile; substitutes for any staff member with temporary access that expires by itself; archive, never delete; tests for isolation, driver scope, permissions, substitutes and history.

**Audit (reused):** `StaffMember` (designation enum, lifecycle status with `StatusChange` history, login), `TransportRoute` / `RouteStop` / `StudentTransport` (route → stop → student), `WorkCover` (one-day staff cover, unchanged), teacher period cover (`/school-admin/substitutes`, unchanged), reset password, audit log, `ctx.db` tenant scoping. Replaced: the 5 coarse `StaffPermission` values.

**Found and fixed (tenant isolation):** `AdmissionFollowUp`, `FeeConcession`, `FamilyPayment` and `FeeCarryForward` carry `schoolId` but were missing from `TENANT_MODELS`, so a lookup by id alone (e.g. a family receipt, revoking a concession) could reach another school's row. Added to the scoped list.

**Changed — permissions (`src/lib/staff-access.ts`, `src/server/auth/staff-access.ts`):**

- Catalogue of 24 grants over 7 modules (library, students, transport, fees, expenses, payroll, inventory), each with an action (View/Create/Edit/Delete/Export/Manage) and "Limited" where the server narrows it. Every grant gates a real page/service/API.
- `StaffMember.grants` holds a person's grants; effective access = own grants + grants of a substitution active today − what the designation can never hold (Librarian: students, transport, finance; Driver/Attendant: the school-wide student directory). Read from the DB every request; inactive staff hold nothing.
- **Permission meaning changed:** a Librarian no longer gets the library implicitly — it is in their grants (carried over by the migration, and the role's default for new librarians), so the admin can now restrict it. A driver/attendant's own route needs `transport.myroute` (given to existing drivers by the migration). Drivers who had "View students" lose the full directory (excluded); they get their route's students instead.
- All services moved to grants: library (separate add / edit / issue-return-renew / lost-damaged / fines / reports), fee desk (`fees.view` read-only, `fees.collect`), student directory (guardian contact only with `students.contact`), all-routes transport, photos (a driver sees only their riders'), search, alerts, receipts; expenses, payroll and inventory services opened to staff with their grants.
- **Roles:** `StaffRoleProfile` per school — one built-in per designation (created on first use, staff linked automatically) and custom roles on a base designation. A role's default grants seed new staff; "apply to staff in this role" pushes a change. Staff form picks a role profile.

**Changed — School Admin UI:**

- Staff → **Non-teaching staff**: role cards (count per role) → role page (module × action matrix, edit default permissions, staff in the role, archive custom roles) → staff profile. Custom role form.
- Staff profile tabs: **Profile** (details, status/archive via lifecycle panel, login, reset password), **Role & access** (per-person permission checklist grouped by module, matrix, temporary access, access history from the audit log), **Work** (routes driven/attended, responsibilities by module, loans issued, payments taken), **Substitutes** (assign: substitute, dates, reason, notes, temporary access pre-ticked from the original's grants, take over routes; covered-by and covering history with status and "End now"), **Attendance & leave**.
- Cover page renamed **Cover & substitutes**: teachers' period cover as before, plus staff substitution history filterable by status.
- Transport route page: today's pickups/drops and 14-day history with crew-reported issues.

**Changed — staff portal:**

- One dashboard for every role; panels follow grants (today's route timeline with student counts per stop, library desk, fee desk, inventory summary) plus a "covering as a substitute" banner. Sidebar from grants (`STAFF_MODULE_NAV`).
- **My route** (`/staff/my-route`, `/staff/my-route/{routeId}`): pickup list / drop list by stop, only the route's students (name, class, section, stop, time), guardian contact only with permission, Picked up / Not present / Dropped / Issue buttons (today only), route history, report issue. Covers a colleague's route during a substitution.
- New staff pages from shared screens (no duplicate markup): **Expenses**, **Payroll** (read-only without `payroll.pay`), **Inventory** (+ item page); **Fees** read-only with `fees.view` only.

**Substitutions (`src/server/staff/substitutions.ts`):** `StaffSubstitution` (original, substitute, start/end date, reason, notes, temporary grants, cover routes, created by/at, ended by/at). Status computed from dates — SCHEDULED / ACTIVE / EXPIRED / ENDED — so access starts and expires with no job and no manual removal; nothing is deleted; the original's grants and routes are never touched. Refuses: same person, end before start, >180 days, inactive substitute, another school's staff, temporary grants the substitute's role can never hold, overlapping duplicates. Teachers keep period cover on Teachers → Cover.

**Driver (`src/server/transport/driver.ts`):** route scope = routes they drive/attend + routes of an original they cover today. `TransportTripLog` (one mark per student per trip per day) and `TransportIssue`.

**API (`docs/API.md`):** `/staff/{id}` GET/PUT (status archives), `/staff/{id}/permissions` GET/PUT, `/staff/roles` GET/POST, `/staff/roles/{id}` GET/PUT, `/staff/substitutions` GET/POST, `/staff/substitutions/{id}` PUT, `/staff/substitutions/{id}/end` POST, `/transport/my-route` GET, `/transport/my-route/{routeId}/students` GET, `/transport/trips` POST, `/transport/issues` POST. `/staff` POST accepts `roleProfileId` and `grants` (old `permissions` names still converted).

**Migration:** `20261013090000_staff_roles_substitutes_trips` — additive: `StaffMember.grants`, `roleProfileId`; tables `StaffRoleProfile`, `StaffSubstitution`, `TransportTripLog`, `TransportIssue`; enums `TransportTrip`, `TransportTripStatus`. Backfill copies each person's old permissions into grants meaning for meaning, plus the library for Librarians and own-route grants for drivers/attendants (minus excluded). `StaffMember.permissions` is kept, unread. Applied to the local test DB only — **NOT applied to Neon**.

**Tested:** new `tests/integration/staff-roles-substitutes.test.ts` (12 tests: built-in and custom roles, defaults for new staff, apply to role, librarian never finance; grant on/off for services and the permissions API, cross-school 404, staff 403; Route 01 driver sees only its 3 students and per-stop counts, Route 02 driver refused, marking rules, contacts only with permission, issue report and admin activity; API with the same scope; substitute scheduled → active → expired from the dates, original unchanged, cross-role temporary fee access and end-early; refusals; School B isolation; archived driver holds nothing, records kept). Existing tests updated to grants (old permission names still accepted via `staffSchema`). Full suite 821/821, typecheck, lint, production build (local DB) clean. Not checked in a browser.

**Open:** receptionist enquiries, security visitor logs and support-staff tasks have no module yet (roles exist, only common pages); staff salaries remain teacher-only; parents do not yet see pickup/drop status; `StaffMember.permissions` column can be dropped later.

---

## 5 Oct 2026 — Driver routes, Website in the sidebar, Online vs Walk-in admissions

**Asked:** (1) Transport → Routes: route name/number, start/end points, optional ordered stops with location, driver and vehicle, shown clearly to the assigned driver, no unrelated modules for drivers. (2) A Website entry in the School Admin sidebar as the one place for the public site and online admission form (profile, logo, address, about, principal's message, contact, links, form questions, preview, publish/unpublish, dates, classes, instructions, highlights, public link, preview). (3) Students → Admissions split into Online admissions and Walk-in admissions, each keeping its source and history. No duplicate systems.

**Audit:** Transport already had routes (name, vehicle, driver, attendant), stops (name, order, times; add/remove), and a driver's own route on the staff dashboard. Website already had profile (name, logo, address, about, principal, contact, colours), pages and gallery, but sat under Settings. The admission form's settings (dates, classes, instructions, highlights, map/website links, extra questions) lived at Admissions → "Admission page"; there was no publish switch or preview. Admissions showed Enquiries / Applications / Admission page tabs, and the Applications list mixed sources (old office-entered applications with Website ones).

**Changed:**

- **Transport:** routes have an optional **route number**, **start point** and **end point**; stops have a **landmark/location**; a stop can be **edited** (name, landmark, order, times) as well as added/removed; stops stay optional. Route form also takes notes for the driver. Route list and page show number and start → end.
- **Driver:** new **My route** page (`/staff/my-route`) and sidebar link, shown only to a driver/attendant assigned to a running route (`hasAssignedRoute`). Shows number, start → end, vehicle, the other crew member and phone, notes, and stops in order with landmark and times; rider count only. Same panel on the staff dashboard. No grant is added: Students, Fees, Library and the all-routes Transport page stay closed unless permitted.
- **Website:** own sidebar entry (no longer under Settings) with tabs **Site & profile** and **Admission form**. Site & profile gains an admission-form status card and copyable website / admission-form links. **Admission form** (`/school-admin/website/admission`, reusing `AdmissionPortal` and the existing `PortalForm`): status, **Publish / Unpublish**, copyable public link, **Preview public page** (`?preview=1` — only this school's admin sees the form, switched off, even when unpublished or closed), the settings form, and a live **form preview** (the real public form with every control disabled). Old `/school-admin/admissions/portal` redirects here.
- **Publish:** `AdmissionPortal.isPublished` (default true, so nothing changes for existing schools). Unpublished → public page says "Online admissions are not open" and `submitApplications` refuses on the server.
- **Admissions:** tabs are now **Online admissions** (applications from the public form only, with a Submitted → Under review → Shortlisted → Approved → Converted / Rejected strip that filters) and **Walk-in admissions** (the existing enquiry workflow, renamed; convert each child into a student as before). Older office-entered applications (source Walk-in/Phone/Office) are listed separately at `?origin=office`, linked from Walk-in admissions; every application keeps its source and history.
- Reverses an earlier choice: Website was folded under Settings; it now has its own sidebar entry (sidebar 16 → 17 entries; nav test updated).

**Migration:** `20261012090000_routes_website_admissions` — additive: `TransportRoute.code`, `startPoint`, `endPoint`; `RouteStop.location`; `AdmissionPortal.isPublished` (default true). Applied to the local test DB only — **NOT applied to Neon**.

**Tested:** new `tests/integration/routes-website-admissions.test.ts` (7 tests: route with number/start/end and no stops; driver and attendant see it with crew; stops with landmark in order, edit; My route link and no students/fees/library/all-routes for the driver; other school and teachers cannot edit; unpublish blocks the public form and the server, publish reopens, other school untouched, only admin can toggle; online vs office lists and counts, isolated per school). Updated nav unit test and transport test fixtures. Full suite 809/809, typecheck, lint, production build (local DB) clean. Not checked in a browser.

---

## 5 Oct 2026 — Phone numbers: one input, one rule, everywhere

**Asked:** standardise every phone/mobile field: India (+91) default with a country-code selector, max 10 local digits, block letters and extra digits (typed or pasted), one reusable component and one validation on frontend and backend, without breaking existing numbers or forms.

**Audit:** server schemas already shared `requiredPhone` / `optionalPhone` (`src/lib/validation/common.ts`), but the rule was loose (`+?[0-9][0-9\s-]{6,18}` — up to ~19 digits, any format). The staff, teacher and student CSV imports each had their own copy of that regex. The platform's "add school admin" schema had no phone check at all (any 20 characters). All 16 phone inputs were plain text boxes.

**Changed:**

- `src/lib/phone.ts` (new, shared by client and server): country list (+91 first), `parsePhone`, `normalizePhone`, `phoneErrorFor`, `splitPhoneForInput`. Rule: India exactly 10 digits; other listed countries their own length, never more than 10; digits only; no leading 0 after the code. Stored as `"+91 9876543210"`. Older spellings (`98765 43210`, `+91-98765-43210`, `09876543210`, `919876543210`) still parse.
- `requiredPhone` / `optionalPhone` now use it and normalise to the stored form, so every form and every API route that uses them is checked on the server. Platform `createSchoolAdminSchema.phone` now uses `optionalPhone`. Staff, teacher and bulk-student CSV imports use the same rule and store the standard form.
- `PhoneField` (new, `src/components/forms/fields.tsx`): country-code select (+91 preselected) + digits box; strips letters, stops at the country's maximum, reads a pasted full number (`+91 98765 43210` → +91 / 9876543210), refuses a paste with letters or too many digits with a message; submits one hidden field with the same name, so server field names are unchanged. Works uncontrolled or controlled; clears on form reset.
- Replaced every phone `TextField` with `PhoneField`: student emergency phone, student mobile, guardian mobile (add student / add guardian), parent phone + alternate (admin edit), parent self-profile phone + alternate, teacher phone, staff mobile, enquiry mobile + alternate, public admission application, school website profile phone, platform school registration, platform add-admin, marketing contact form.
- Existing records are not changed in the database; an old value shows in the new input (country + digits) and is saved in the standard form next time it is edited. Matching parents by phone already used the last 10 digits, so it is unaffected.

**Migrations:** none.

**Tested:** new `tests/unit/phone.test.ts` (parsing every common spelling, other countries, refusing letters / short / long / leading-zero / unknown code, max 10 digits, error messages, schemas, platform schema); staff CSV import test in `staff-roles-access.test.ts`. Updated `admissions` and `parent-self-profile` tests to expect the stored standard form. Full suite 802/802 passing (all suites ran — weekday). Typecheck, lint, production build (local DB) clean. `PhoneField` not checked in a browser.

**Open:** numbers already stored in an invalid form (e.g. fewer than 10 digits) show their digits and must be corrected when that record is next saved.

---

## 4 Oct 2026 — Librarian locked to the library; permanent issue history

**Asked:** Librarian must not see or open Students or Transport (UI and server), keep Library; keep a complete, permanent history of every book issue (student, admission no., class, book, copy, issue/return date and time, due date, status incl. Lost/Damaged, who issued, who processed the return, fine); an Issue History view with search and filters, per-student and per-book/copy history; keep all existing library rules.

**Root cause (Students/Transport):** no code gave them to a Librarian — the sidebar, page guards and services all read `StaffMember.permissions`, and the librarian's record had "View students" and "View transport" ticked. Nothing stopped a designation from holding an unrelated grant.

**Changed (permission meaning changed for Librarian, as asked):**

- `STAFF_ROLE_EXCLUDED` in `src/lib/validation/operations.ts`: a Librarian can never hold `VIEW_STUDENTS` or `VIEW_TRANSPORT`. `effectiveStaffPermissions` drops them, so the sidebar, dashboard tiles, `/staff/students`, `/staff/transport`, the student directory service, `listRoutes`, the header search and photo access all refuse at once — including for records that still have the boxes ticked.
- Saving a staff record drops excluded grants (`saveStaffDetails`); the form greys those boxes out for a Librarian ("Not available for a librarian").
- Unchanged: the issue desk's own borrower search (`searchBorrowers`, `MANAGE_LIBRARY`: name, admission no., class — no guardian details) and borrower photos at the desk.

**Issue history (reuses `BookIssue` — one row per issue, never overwritten or deleted):**

- New columns: `returnedAt` (time the return was processed), `returnedById` (who), `damagedOn` (damaged is no longer shown as "lost"), `borrowerGroup` (class – section • stream on the day of issue). Issue time = `createdAt`; issued by = `issuedById` (existing).
- `issueBook` stores the class snapshot; `returnBook` and lost/damaged reports store who and when. Lost → `lostOn`, Damaged → `damagedOn`.
- `listLoans`: views Issued / Overdue / Returned / Lost / Damaged / Unpaid fines / **All issue history**; search by student name, admission no., employee ID, book title/author/ISBN or copy code (BK-…); filters by book, copy or student; history sorted newest first. API `GET /api/v1/library/loans` accepts the new views.
- Desk list shows copy, admission no., class at issue, issue date + time and who issued, due date, return date + time and who processed it, status, fine/charge.
- Book page (admin and staff): full borrowing history; each copy has a **History** link (`?copy=`). Admin student page: **Library** card with every book ever issued.
- A student with library loans can no longer be erased (`studentDeletionBlockers`); before, the FK would have failed with a server error.

**Migration:** `20261011090000_library_issue_history` — additive (4 nullable columns + FK). Backfill: loans closed as "Returned damaged" move from `lostOn` to `damagedOn`; existing student loans get `borrowerGroup` from the placement in the session covering the issue date. Applied to the local test DB only — **NOT applied to Neon**.

**Tested:** new `tests/integration/library-issue-history.test.ts` (9 tests: librarian with old Students/Transport ticks refused everywhere, borrower search still works, save drops the grants; issue → return → re-issue keeps both records with issuer/returner/time/class; double issue refused; copy freed on return; lost vs damaged filters; overdue; search by admission no./copy/book; student history; deletion blocked; school B sees nothing). Full suite 747 passed, 45 skipped; `parent-portal` and `student-portal` refuse to run on a Sunday. Typecheck, lint, production build (local DB) clean. Not checked in a browser.

**Open:** run `npx prisma migrate deploy` on Neon. Old loans have no return time or returner (shown as date only).

---

## 4 Oct 2026 — Non-teaching staff: audit, staff dashboard, admin staff overview

**Asked:** audit the non-teaching staff system (types, permissions, sidebar, guards, dashboards, attendance, admin management), find why a Librarian sees Students and Transport, then make only the changes actually needed. Stop before destructive DB changes or changing permission semantics.

**Audit findings:**

- Staff types already exist (`StaffRole`: Accountant, Receptionist, Librarian, Driver, Transport attendant, Peon, Office staff, Coordinator, Security, Lab assistant, Other). One common portal at `/staff`; no per-type routes.
- Permissions: `StaffMember.permissions` (VIEW_STUDENTS, VIEW_LIBRARY, MANAGE_LIBRARY, VIEW_TRANSPORT, COLLECT_FEES), read from the DB on every request by `staffPermissions()`; Librarian implies MANAGE_LIBRARY only. Sidebar (`staffNav`), page guards (`requireStaffModule`) and services (`assertAdminOrStaffPermission`) all use it; tenant scoping via `ctx.db`.
- **Librarian seeing Students/Transport:** the code adds those links only when the stored permissions contain VIEW_STUDENTS / VIEW_TRANSPORT — no role-based fallback. So the librarian's record has those boxes ticked (it could not be confirmed on Neon from here). Fix: untick them on the staff member's page; the new "Access" card flags them as "Not usual for a librarian".
- Staff dashboard read permissions without the status check (an inactive staff member's dashboard could still list modules); the sidebar did not.
- Admin had only the daily register (Attendance → Staff): no staff overview, no per-person attendance history or leave on the staff page.
- Not in the app (not built): enquiries for staff, lab inventory for staff, tasks for peons, visitors/entry-exit for security, coordinator module, staff salary (`SalaryPayment` is teacher-only), HALF_DAY attendance status.

**Changed:**

- Staff dashboard (`/staff/dashboard`): permissions now come from `staffPermissions()` (status-aware). New panels in `src/features/staff/work-panels.tsx`: **My attendance** (today + 30-day counts) for everyone; **Today's fee desk** (collected today, taken by you, latest receipts; Collect fee / Family payment) with COLLECT_FEES; **My route** (vehicle, stops in order with times, rider count) for a driver/attendant assigned to a route — their own route only, no student names.
- New server functions: `feeDeskToday`, `myAssignedRoutes` (`src/server/staff/portal.ts`); `staffOverview`, `staffRecord` (`src/server/operations/staff.ts`, School Admin only).
- Admin Staff page: today's summary (current, present, absent, on leave, not marked), designation chips that filter, a **Today** column, link to mark attendance.
- Admin staff detail page: **Access** card (each grant, "comes with designation", "not usual for designation"), **Attendance** by month with previous/next, **Leave** (latest 20).
- New-staff form no longer pre-ticks "View students" for an Accountant (existing staff unchanged).

**Migrations:** none.

**Tested:** new `tests/integration/staff-roles-access.test.ts` (11 tests: librarian/accountant/driver nav + server refusals, inactive staff hold nothing, admin overview/record, teacher and staff cannot mark, own register only, school isolation). Full suite: 738 passed, 45 skipped; `parent-portal` and `student-portal` refused to run because today is Sunday. Typecheck, lint and production build (against the local test DB) clean. Not checked in a browser.

**Open — needs a decision (changes permission meaning or the schema):** driver's assigned-student list; HALF_DAY status; enquiries permission for receptionists; lab inventory permission; delegating staff attendance to a permission; staff salaries.

---

## 3 Oct 2026 — Parent profile page: cleaner layout, normal-sized photo

**Asked:** the parent profile page looked bad — the profile photo was far too big. Make it a normal profile page where the parent can change their profile.

**Changed:**

- `/parent/profile` header is now a plain card instead of the big gradient banner: an 80px avatar (64px on phones) with a camera button on its edge, name, "Parent · school · N children", phone/email/city on one line, and a small "Profile complete" bar on the right.
- The photo is changed right on that avatar (new `src/features/photos/avatar-editor.tsx`): pick a file → it previews in the circle with **Save photo / Cancel**; **Change photo · Remove** links sit under the name. Same `uploadPhotoAction` / `removePhotoAction` as before. The separate "Profile photo" card (a second large photo) is gone.
- "My details" is now **Personal information** in settings style (`src/features/parent/profile-form.tsx`): each group — About you, How the school reaches you, Home address — has its title and hint on the left and fields on the right on wide screens, divided by lines, with **Save changes** at the bottom right.
- "Kept by the school" sidebar is narrower, with each item as a label over its value.
- `PhotoUploader` is unchanged and still used by `/account`; teacher/student/staff profiles are unchanged.

**Migrations:** none.

**Tested:** typecheck and lint clean on the changed files. Not checked in a browser.

**Open:** same compact header could be applied to teacher/student/staff profile pages if wanted.

---

## 3 Oct 2026 — Parent "My account" redesign; parents update their own details

**Asked:** redesign the parent's account page, and let parents update their own profile and personal details.

**Changed:**

- **`/parent/profile` is now "My account".** It opens with a coloured header: photo, name, school, number of children, mobile / email / city, and a "Profile complete %" bar.
- It has three tabs:
  - **My details:** an editable form in three groups, and a "Kept by the school" card.
    - About you: first name, last name, occupation.
    - How the school reaches you: mobile, alternate number.
    - Home address: house / street, city, state, 6-digit PIN.
    - The profile photo uploader sits beside the form.
    - "Kept by the school" lists what only the office can change.
  - **My children:** one card per child (photo, class, section, roll, admission number, "You are: Mother / Father", primary contact) with Attendance / Results / Homework / Fees shortcuts.
  - **Sign-in & security:** change password, language and theme, and a link to notifications.
- **What a parent cannot change** (stated on the page):
  - The sign-in email (a login change).
  - Links to children and the relationship.
  - ID proof.
- **Safeguards:**
  - The record is found from the sign-in, never from an id sent by the browser.
  - A mobile number another parent at the same school uses is refused, because families are linked by that number.
  - An archived record is refused.
  - The login's name and phone are kept in step with the record.
  - Each save writes a `PARENT_SELF_UPDATED` audit entry listing the fields changed, and stamps `selfUpdatedAt`.
- **Office side:**
  - The parent page gains a "Contact & address" card, showing "Updated by the parent on …".
  - The guardian edit form on the student page has the new fields.
  - When the API or an older form leaves the new fields out, they are kept as they are, not cleared.

**Migration:** `20261010090000_parent_self_profile`.

- Adds nullable columns to `Parent`: `alternatePhone`, `city`, `state`, `postalCode`, `selfUpdatedAt`. It only adds columns; no existing data changes.
- Applied to the local test database only. **NOT applied to Neon**; it needs the two migrations before it, which `migrate deploy` applies in order.

**Tested:**

- New `tests/integration/parent-self-profile.test.ts` (5 tests):
  - Every field saves and the login's name is synced.
  - The audit entry is written, and another school's parent is untouched.
  - Saving with no changes does nothing.
  - A mobile used by another parent at the same school is refused; the same number at another school is allowed.
  - PIN and alternate-number checks.
  - Teachers and admins are refused; an archived record is refused.
  - An office save without the new fields does not wipe them.
- Full suite **772/772**; typecheck and lint clean; build passing.
- **In Chrome against a scratch database (as Rupa Bose):**
  - Entering "4520" as the PIN was refused on the field.
  - Corrected and saved: the database row is updated and the page shows "Last updated by you".
  - Screens checked: the children tab and mobile.

**Open:**

- Run `npx prisma migrate deploy`.
- Teachers, staff and students still have read-only profiles; they were not asked for here.

---

## 3 Oct 2026 — Family enquiries, fee discussion, multi-child applications, admission page

**Asked:**

- Audit first.
- Then keep three things clearly separate:
  - **Enquiry**: a family's interest, never a student or a fee.
  - **Public application**: submitted → under review → shortlisted → approved → converted, or rejected.
  - **Internal admission**: creating a student.
- One parent can have several children on one enquiry or application.
- Streams follow the class:
  - Nursery–8: no stream.
  - Class 9–10: optional.
  - Class 11–12: required.
  - Checked in the browser and on the server.
- An admin-managed fee discussion:
  - Per child: fixed or percentage discount.
  - An optional family / sibling discount.
  - History, and internal notes.
- Agreed discounts reach real fees only after confirmation, and only on each child's own account.
- Follow-ups, and search by any child.
- Existing parents are linked, not duplicated.
- Admission page settings.
- Tests.

**Audit (before):**

- Enquiries and applications were the same table, with one child per row.
- Streams were always optional, including on the server.
- There was no fee discussion, no portal settings and no multi-child form.

Reused unchanged:

- Parent dedupe by mobile or email.
- `createStudent`.
- Concessions (`FeeConcession`).
- Tenant-scoped `ctx.db`.

**Changed:**

- **Enquiries** (`/school-admin/admissions/enquiries`):
  - Taken in five steps: Parent → Children (add / remove child cards) → Fee discussion → Follow-up → Review.
  - Numbers look like `ENQ-2026-00001`.
  - Statuses: NEW, CONTACTED, FOLLOW_UP, CONVERTED (automatic, once every child still coming is admitted) and CLOSED (needs a reason, can be reopened).
  - Each child can be marked "not proceeding".
  - The list shows: parent, number of children, class and stream badges, fee status, discussed / discount / final totals, and the next follow-up.
  - Filters: status, class, stream, follow-up due, and received dates in the school's time zone.
  - Search covers parent, mobile, email, ENQ number and **any child's name**; the matching child is highlighted.
- **Fee discussion:**
  - Per child: original amount, discount (none / fixed / percentage), reason (suggestions plus free text), notes. The final amount is worked out the same way in the browser preview and on the server.
  - A discount larger than the fee, or over 100%, is refused.
  - Family / sibling discount: applied on what is left after each child's own discount.
  - Status: discussing / agreed, with who agreed and when. Changing a figure after it was agreed sends it back to "discussing".
  - Every change is stored in `EnquiryFeeRevision`.
  - None of this creates a charge.
- **Existing parent:**
  - The enquiry shows "Existing parent found", with that parent's current children.
  - A match by mobile or email links in one click.
  - A match by name only asks for confirmation first.
  - Another school's parent cannot be linked.
- **Admit a child** (`…/enquiries/[id]/convert/[childId]`):
  - The normal admission form, filled in, with the linked parent preselected.
  - A parent who matches only by name is listed, never preselected.
  - Brothers and sisters admitted later join the same parent.
  - No fee is touched.
- **Apply agreed discount** (`…/enquiries/[id]/fees`):
  - Shows each admitted child's agreed amount (own discount plus a share of the family discount) against their real fees.
  - The office picks which fee each concession goes on, ticks a confirmation, and presses Confirm.
  - Writes a `FeeConcession` on that child's own charge; the charge keeps its original amount.
  - Cannot be applied twice.
  - If the child has no fees yet, the page says to charge fees first.
- **Public applications:**
  - One form for one or several children; each child gets their own `APP-2026-00001` number, linked to their siblings by `familyKey`.
  - Statuses are now SUBMITTED / UNDER_REVIEW / SHORTLISTED / APPROVED / REJECTED / CONVERTED, with a progress strip on the detail page.
  - Only an **approved** application can be converted, including through the API's accept route.
  - The detail page shows the siblings and the answers to the school's extra questions.
- **Admission page settings** (`/school-admin/admissions/portal`):
  - Opening and closing dates; classes open for admission; instructions; facilities / highlights; map and website links.
  - Up to 10 extra questions: text, long text, date or choice, optionally required.
  - The standard questions cannot be removed.
  - Name, logo, address, about and the principal's message still come from Website.
  - The public page shows all of this, and a "closed / opens on" notice outside the dates.
- **Other screens:**
  - An Enquiries / Applications / Admission page tab bar.
  - `/school-admin/admissions/new` now redirects to the new enquiry form.
  - Dashboard: enquiries and applications are counted separately. "Today" counts now start at midnight in the school's time zone (they started at 05:30 before).
  - A "follow-ups due" alert on the dashboard and in notifications.
  - A student created from an enquiry cannot be hard-deleted.
- **Removed:** the office "enquiry" stored as an application (`createEnquiry` / `updateEnquiry` on `AdmissionApplication`, from 2 Oct). Office enquiries are now family enquiries; application notes and calls stay.

**Migration:** `20261009090000_family_enquiries_admission_portal`.

- New tables: `Enquiry`, `EnquiryChild`, `EnquiryFollowUp`, `EnquiryFeeRevision`, `AdmissionPortal`.
- `AdmissionApplication` gains `familyKey` and `customAnswers`.
- `AdmissionStatus` is rebuilt. Existing rows are mapped: **ACCEPTED → CONVERTED, WAITLISTED → SHORTLISTED**.
- Applied to the local test database only. **NOT applied to Neon.** It needs `20261008090000` first; `migrate deploy` applies both in order.

**Tested:**

- Baseline before any change: 744/744.
- After: **767/767**; typecheck and lint clean; production build passing.
- New test files:
  - `tests/unit/fee-discussion.test.ts`: discounts, the §29 totals, sharing a family discount, the stream rule, form rows.
  - `tests/integration/family-enquiries.test.ts`:
    - One child and three children.
    - Stream rules on the server.
    - Adding and removing children.
    - Search by child.
    - Statuses.
    - Fee history, the limits and the family discount.
    - Existing parent linked, and admitting with no duplicate parent.
    - No fee created by conversion.
    - Concession only after confirmation, on the child's own charge, and only once.
    - Name-only parent match needs confirmation.
    - School B and teachers are refused.
  - `tests/integration/public-applications.test.ts` (replaces `enquiry-conversion.test.ts`):
    - Siblings and their numbers.
    - Stream rules.
    - Dates, classes on offer and extra questions.
    - Conversion only after approval.
    - Name-only parent match.
    - Duplicate child.
    - Isolation.
- Updated: `admissions.test.ts` (approve before accepting; 5-digit numbers).
- **In Chrome against a scratch database:**
  - Public form: submitted 2 children; Class 11 with no stream was refused on the child's own card, then accepted → `APP-2026-00003` and `APP-2026-00004`, with a shared family key and the custom answer stored.
  - New enquiry form: the §29 family (Aarav Class 8, Anaya Class 9 at 10%, Riya Class 12). The missing Commerce stream was refused and the form jumped back to the Children step; once fixed it saved ₹35,000 / ₹40,500 / ₹50,000.
  - Screens checked: lists, details, admit page, portal and public page, in light, dark and mobile.
  - Admitting a child and applying the discount were tested by the integration tests, **not clicked through in the browser**.

**Open:**

- Run `npx prisma migrate deploy` on Neon.
- Enquiry → application (as opposed to → student) is not built.
- The enquiry and admission screens are English only.

---

## 2 Oct 2026 — Exams & tests, needs attention, family fees, concessions, carry forward, enquiries, dashboard

**Asked:** audit first, then implement: simpler exams/tests/results for teachers and admins; configurable "needs attention" with support actions; the remaining audit items (subject/stream rename & archive, class-test edit/delete, promotion undo, library lost/damaged and overdue alerts, enquiry → student, parent archive); an admin dashboard redesign with quick actions; family fees with one combined payment; concessions; carry-forward of last session's balance; safe bulk operations; tests for all of it.

**Changed:**

- **Tests (teacher):** My tests / Create test (with preview, only the teacher's own subject, class, section and stream) / Enter marks (draft → submit, which locks). Marks are checked against 0..max; a test can be edited while a draft and deleted only before marks exist. **Admin:** All tests, Pending marks, Published results, Student performance, Term exams (the old exams list moved to `/school-admin/exams/term`); the admin can reopen submitted marks with a reason.
- **Visibility:** students and parents see a class test only once it is submitted, and term exams once published; results are stream-aware.
- **Needs attention:** the rule is set per school (default: latest below 40%, or 2 of the last 3). The reason is shown on each row. The subject teacher can add a note, book an extra class (a Meeting with the student, parents and teacher), share a remark with the parent and mark the support complete.
- **Academics:** subjects and streams can be renamed. Promotion runs can be undone (students who already have records in the new session are skipped).
- **Library:** copies can be marked lost or damaged (closing the loan, with an optional charge) and restored. Overdue alerts go to the student, the parent, library staff and the admin.
- **Admissions:** the enquiry list shows source and status, with view, edit, follow-ups, archive and **Convert**. Convert pre-fills the student form, links the existing parent (matched by phone or email), sets the status to Converted and keeps the history.
- **People:** a parent can be archived (and restored) once no child is still at the school; there is "Resend activation" for parents who have not activated.
- **Bulk:** assign a stream to several students, within its seats.
- **Fees:**
  - Concessions are fixed or a percentage. The original amount is kept, with the reason and the approver, and a concession can be withdrawn.
  - "Carry forward outstanding" adds a linked "Previous outstanding (session)" fee; the old session shows it as carried forward.
  - Family fees show each child separately plus the family total. One family payment is split into per-child receipts (`FAM-n/1`, `FAM-n/2`, …); the school switches this on or off.
- **Admin dashboard:**
  - Sections: Today, Students (by stage and boys/girls), Staff, Academics, Money (6-month trend), Happening soon, Needs action.
  - 8 quick actions.
  - Each section streams on its own.

**Migration:** `20261008090000_exams_fees_admissions` — new enums/columns/tables (test lifecycle, attention settings, parent remark, copy condition, enquiry source/follow-ups/archive, admission type, parent archive, concessions, family payments, carry forward) and a backfill marking existing class tests with results and papers of published exams as submitted. Applied to the local test DB only. **NOT applied to Neon.**

**Tested:**

- New test files: `tests-attention`, `library-lost-overdue`, `academic-archive-reversal`, `enquiry-conversion`, `family-fees` and `people-bulk`. They cover teacher scope, marks validation, visibility, multiple children, family allocation, discounts, carry-forward, conversion, duplicate parents, needs attention, support permissions, archive, promotion reversal, library, bulk permissions and school isolation.
- Updated: the exams, portal and fee-receipt tests.
- Results: 744/744 tests passing; typecheck and lint clean; production build passing.
- Screenshots checked against a scratch database: admin dashboard (light, dark, mobile), teacher tests and marks entry, admin tests and performance, enquiries and convert, parent family fees, family payment desk, carry forward, payments, student results.

**Open:**

- Run `npx prisma migrate deploy`.
- No online payment gateway.
- Staff "archive" uses the existing leaver lifecycle.
- The new screens are English only.

---

## 1 Oct 2026 — Events, Calendar, Notices, Meetings and Leave separated

**Asked:**

- Reorganise so Events, Calendar, Leave, Notices and Meetings are clearly separate, each with its own page and navigation entry.
- Dashboards show compact summary cards instead of long lists.
- Events and meetings get automatic status: Upcoming → Today → Completed (Cancelled for meetings), with "N days left" and "Tomorrow".
- Notices get read/unread state.
- The calendar is a date overview, with approved leave shown as a marker.
- Leave has Pending / Approved / Rejected views.
- Navigation for each role follows the user's lists. Nothing is removed.

**Found before changing anything (where they were mixed):**

- The teacher, parent, student and staff **Notices pages also listed upcoming events**.
- **The calendar was a tab under Notices** for teachers, parents and students. For the admin, **Events was a tab under Calendar**.
- Leave was spread around:
  - Admin: student leave was a tab under Students, staff leave under Teachers.
  - Teacher: one Leave entry held both their own leave and their students' leave.
- **No Events page** existed except the admin's.
- **Notices had no read state.** The alert read-keys are pruned, so they cannot hold one.
- **No countdown** on events or meetings.

**Done:**

- **Navigation (all roles):** Events, Calendar, Notices, Meetings and Leave are separate entries, in the user's order.
  - **Admin:** the user's 16 entries. Homework moved to an Academics tab, Expenses / Salaries / Payroll to Fees tabs, Inventory to a Library tab, and Reports (attendance) to an Attendance tab. The new Leave entry has tabs "Student leave" and "Staff leave & cover".
  - **Teacher:**
    - "Student concerns" (tabs Concerns / Needs attention).
    - "Leave requests": students' leave, with "My leave" as a tab.
    - New Events page.
    - Calendar is its own entry.
  - **Parent:** new Attendance / Homework / Results entries. With one child they open that child's page; with several they ask which child. Also "Concerns", a new Events page, and Calendar as its own entry.
  - **Student:** "Concerns" (the existing complaints page, since students do not raise subject concerns), a new Events page, and Calendar as its own entry.
  - **Staff:** new Events and Calendar pages. Granted modules (library, fees, …) still appear only when granted.
  - The first entry is now called "Dashboard" for every role.
- **Events** (`/{role}/events`, plus a detail page each):
  - Upcoming / Completed tabs with counts. Cards show a date tile, time, place, status and countdown ("14 days left", "Tomorrow", "Today", "Completed"), worked out from the date — nobody marks an event completed.
  - **Admin:** add, edit, delete, view, and **Publish / Unpublish** straight from the list or the event page. Drafts are visible only to the admin.
- **Meetings:**
  - Every meeting now carries a stage (Upcoming / Today / Completed / Cancelled) and a countdown, shown on all meeting lists and the admin meeting page. "Past meetings" is now "Completed".
  - The existing create / edit / cancel / delete rules are unchanged.
- **Notices** (teacher, parent, student and staff): notices only.
  - Each card shows the title, a short description ("Read full notice" expands it), published date, audience, Read/Unread and expiry date.
  - "Mark as read" on each card and "Mark all as read" at the top; unread notices are outlined.
  - Expired notices are kept below as "Notice history".
  - The admin notices pages are unchanged.
- **Calendar:**
  - A fifth colour category, **Leave** (approved student leave only), alongside Holiday, Weekly off, Event, Exam and Meeting.
  - Shown to a parent (their children), a student (themself) and the class teacher (their class). Left off the admin calendar so the whole school's leave does not bury the dates.
  - Leave is still managed only on the Leave pages.
- **Leave:**
  - The admin page is now "Leave Management", with tabs All requests / Pending / Approved / Rejected.
  - The teacher page is now "Leave Requests", with tabs Pending / Approved / Rejected / All.
  - On the parent page, Apply for Leave comes first on phones.
- **Dashboards** (all five roles): four compact cards — **Upcoming events, Pending leave, Unread notices, Upcoming meetings**.
  - Each card shows its count, the one most relevant item (with its countdown) and a View button.
  - Admins and teachers see the oldest pending request; families see their next approved leave.
  - Removed from the dashboards, because the cards replace them: the long notice lists, the admin and staff meeting lists, and the admin "upcoming meetings / events" counts. Their pages are unchanged.
- **Kept working:**
  - Every old URL still works.
  - The notices API (`/api/v1/me/notices`) and the public website's events are unchanged.
  - The meeting rules (`timeStatus`) behind edit and cancel are unchanged.

**Migration:** `20261007090000_notice_reads`.

- Adds the `NoticeRead` table: one row per person per notice they have read. It is tenant-scoped, with composite foreign keys that cascade.
- Additive only; every existing notice starts unread.
- **Not applied to Neon** — run `npx prisma migrate deploy` (it also applies the rooms migration).

**Tested:**

- New `tests/integration/school-life.test.ts` (5 tests):
  - Notice read state is per person; another audience's or another school's notice cannot be marked; "mark all"; history.
  - Drafts are hidden from families; publish is admin only; the 14-day countdown; Completed / Today.
  - Approved leave on the calendar for parent, student and class teacher but not the admin or another school; pending leave stays off.
  - Leave summary counts.
- New unit tests for the lifecycle: 14 days left → Tomorrow → Today (also while running) → Completed; all-day events; Cancelled wins.
- Nav test updated: every role has its own Events, Calendar, Notices, Meetings and Leave entries; none owns another's pages; no tab group puts Calendar or Events behind Notices.
- Full suite: 62 files, 718 tests passing.
- Lint clean; production build passing.
- Screenshots on a seeded local copy:
  - Parent and admin dashboards.
  - Parent Events, Notices and Calendar.
  - Admin Events.
  - Teacher Leave requests.
  - Student dashboard on a phone.
- Crawled 3,022 pages across all roles with no errors.

**Open:**

- Apply both pending migrations to Neon.
- The seed's "Parent-Teacher Meeting" is stored as an Event, not a Meeting (demo data only).

---

## 1 Oct 2026 — Section page: admitted, remaining seats, student list

**Asked:** clicking a section should show how many students are admitted, how many seats remain, and the student list with each student's class, section and stream.

**Done** (page changes only; no data or rules changed):

- **Section page** (`/school-admin/academics/sections/{id}`):
  - Three cards at the top: **Total seats**, **Admitted**, and **Remaining seats**. The remaining card says "Section is full", "Over capacity by N", or that there is no limit while no capacity is set.
  - When the seats are split among streams, a **Seats by stream** card shows each stream's admitted / seats and seats left, with a bar.
  - The **student list** is full width, with columns Roll, Student (photo or coloured initials), Admission no., **Class**, **Section**, **Stream** and Gender.
    - The stream comes from the student's own stream in a shared section, or from the section's stream.
    - In a shared section, a student with no stream is marked "Not set".
  - The section-details, stream-seats and subject-teacher cards sit below, in two columns.
- **Classes & sections page:** each section card now shows **"N seats left"** in green, or **"Full"** in red, when the section has a capacity.

The counts are current (active) students only, the same rule the seat plan and the Classes page use.

**Migrations:** none.

**Tested:**

- Typecheck and lint pass.
- Production build passes.
- Screenshots on a seeded local copy:
  - Class 10 – A with 4 students and a 20/20 Arts/Commerce split.
  - An empty section.
  - The Classes page.
  - Phone width.

**Open:** `20261006090000_rooms` still needs applying to Neon — the user is running `npx prisma migrate deploy`.

---

## 1 Oct 2026 — Rooms, timetable rooms, project audit

**Asked:**
1. Room Management under School Setup.
2. A room picker in the timetable that refuses clashes.
3. An audit of the whole project, grouped into Missing / Broken / Incomplete / Working.
4. Then build Rooms and only the clearly required fixes, without changing working features.

**Done — Rooms** (School Admin → Classes → **Rooms** tab, `/school-admin/academics/rooms`):

- **The room record:**
  - Fields: number/name, type (classroom, science lab, computer lab, library, hall, staff room, sports, music/art/activity, other), capacity, building, floor, description, and active/inactive.
  - Names are unique per school, ignoring capitals and extra spaces.
- **The Rooms page:**
  - Add, edit, view, activate/deactivate.
  - Search by name, building, floor or description; filter by type and status.
  - Each room shows how many periods use it this session.
- **Room page:** the room's details, an edit form, and its week in the timetable.
- **Delete:** only for a room no period has ever used, in any session. Otherwise it is history and can only be deactivated; the Delete button is hidden for those rooms.
- **Deactivating:** a deactivated room can't be picked for new periods. Periods already in it keep it, and the message says how many still use it.
- **Not tied to a class:** a room is never bound to a class. Each period picks its room.

**Done — Timetable:**

- **Room picker:** adding a period offers a Room dropdown of active rooms (or "No room") instead of a free-text box.
- **Periods can now be edited** with the pencil on each period. Once lessons have been recorded for a period, only its room can change; the day, time, subject and teacher stay, because those records describe them.
- **Room clash:**
  - Refused when the times overlap even partly, with a clear message such as "Room Chem Lab is already occupied on Wednesday from 10:00 AM to 10:45 AM (Class 10 – A, Mathematics). Choose another room or time."
  - The check runs by room id, inside the same transaction that saves the period, with the room's row locked. Two admins saving the same room at the same moment cannot both succeed (tested).
- **Rename:** renaming a room renames it on every period. The period keeps a `room` text label, kept in step, so the student, parent, teacher and substitute pages that print the room needed no change.
- **View by room:** the timetable's "View by room" now lists Room records.
- **API:**
  - `/api/v1/rooms` (list/add) and `/api/v1/rooms/{id}` (view/replace/activate/delete).
  - `PATCH /api/v1/timetable/{slotId}`.
  - `roomId` replaces the old `room` text on `POST /timetable`, and `?room=` now takes a room id.

**Done — clearly required fixes from the audit:**

- **Students could still reach fee receipts** if the old `showFeesToStudents` setting was on. That breaks the rule that fees are for parents only. Removed:
  - The student branch of receipt access.
  - `STUDENT` on the receipt API.
  - The unused `getMyFees`.

  The receipt API now admits fee-desk staff (Collect fees), which the server already allowed. The `showFeesToStudents` column stays in the database but nothing reads it.
- **Misleading concern message:** when a parent raised a second concern while one was open, the message told them to "add your message to it", which parents can't do (concerns are no-chat). It now says to follow it under Concerns and raise a new one once it is resolved.

**Audit — found, not changed** (each is a new feature or a product decision; listed for the user to choose):

- **Missing:**
  - No rename/delete for subjects and streams.
  - No delete for staff or individual parents.
  - Class tests can't be edited or deleted.
  - No overdue-book alerts.
  - No withdrawing a single lost copy of a book.
  - No undo for a promotion batch.
  - Admission applications can't be deleted.
- **Incomplete:**
  - Accepting an admission creates no logins and sends no activation email.
  - Fee heads can't be renamed.
  - The void reason is fixed text.
  - The transport API covers only part of the module.
  - Leave pages' body text is English only.
- **Working:**
  - Role guards and zod validation on every action checked.
  - Tenant isolation: every school-owned model is scoped.
  - Attendance registers, staff and student leave, the concern routing, activation and password reset, photos (owner only), promotion, streams.
  - No broken links or TODO stubs.

**Migration:** `20261006090000_rooms`.

- **What it does:**
  - Adds the `RoomType` enum, the `Room` table and `TimetableSlot.roomId` (composite FK to `Room`, no cascade).
  - Converts each school's existing free-text rooms into Room records, matched ignoring case and spaces, and links every period to its room.
- **Dry run on a seeded local copy:** 140 periods → 35 rooms, all linked, no name mismatches, and no schema drift afterwards.
- **Not applied to Neon** — waiting for the user to ask.

**Tested:**

- New `tests/integration/rooms.test.ts` (11 tests):
  - Add, search, filter, and duplicate names.
  - Form validation.
  - Admin only; another school's room is not found and can't be timetabled.
  - Partial-overlap clash, plus back-to-back and other-day cases.
  - Two simultaneous bookings: only one succeeds.
  - Inactive rooms; rename carries onto periods.
  - Delete only when never used.
  - Editing a period's room; a recorded period can only change its room.
- Updated the operations, portal and receipt tests to the new rules.
- Full suite: 61 files, 708 tests passing.
- Lint clean; production build passing.
- Checked in the browser on the migrated copy: the Rooms list, a room page, and editing a period.

**Open:**

- Apply `20261006090000_rooms` to Neon.
- The audit items above, if wanted.

---

## 1 Oct 2026 — Redesign: modern & colourful

**Asked:** redesign the home page and the other pages. Choices: all pages (public home, every role's dashboard, lists and forms, sign-in and account pages); style "Modern & colourful"; no reference design ("you decide").

**Done** (design only — no behaviour, data or permissions changed):

- **Colours and surfaces** (`globals.css`): a brand gradient (indigo → blue → cyan), a softly tinted page background, softer card shadows, slightly rounder corners. New helpers `bg-brand-gradient`, `text-brand-gradient`, `bg-app-wash`, `bg-dots`. Dark mode has its own versions.
- **Shared pieces** (used on every page, so every page changes):
  - Buttons: the main button is an indigo → blue gradient.
  - Cards: rounder, with a soft shadow.
  - Tables: a tinted header row with small capital labels.
  - Page titles: the icon sits on a coloured gradient tile.
  - Stat cards and quick actions: gradient icon tiles, a soft glow in the area's colour, and a lift on hover.
  - Empty states: a gradient icon.
  - Initials avatars: each person gets a fixed colour from their name (`toneFor` in `tones.ts`), so the same person looks the same everywhere. The parent's child cards use them too.
- **App frame:** the school card in the sidebar is a gradient; the current page in the menu is a gradient pill; the top bar is frosted glass; on phones, the bottom bar shows the current tab with a soft pill.
- **Dashboards:** every role's home (admin, teacher, parent, student, staff) opens with a gradient welcome banner (`PageHeader variant="hero"`).
- **Public home** (`features/marketing/sections.tsx`):
  - A colour-mesh hero with a gradient headline.
  - Colour-coded feature, role and step cards.
  - A glowing security section.
  - A raised "Most popular" price card.
  - Rounded FAQ.
  - A gradient call-to-action.
- **Sign-in, activate, forgot and reset password:** a split screen, with a gradient panel about SchoolOS on wide screens and only the form on phones. The login page now uses the shared `AuthCard`.

**Migrations:** none.

**Tested:**

- Typecheck, lint and production build pass.
- Before and after screenshots, in light and dark mode, at desktop and phone widths: home, sign-in, admin dashboard, students list, teacher dashboard, parent dashboard.
- Full test suite: 60 files, 698 tests passing.

**Open:** nothing new. The sign-in loading skeleton is still the old centred card (it shows for a moment only).

---

## 1 Oct 2026 — Admin meetings: create, edit, reschedule, delete

**Asked:** the School Admin should be able to create, edit, update and delete meetings.

**Found:** create and edit already worked (edit only before the meeting starts), but **delete** was allowed only after cancelling first, so the Delete button did not appear on a normal meeting.

**Done:**
- **Delete any meeting** in one step (with a confirmation), upcoming, cancelled or past. It disappears from everyone's list; the audit log keeps what it was. If a student's support record used it as an extra class, that link is removed and a note is added instead of blocking the delete.
- **Reschedule a cancelled meeting:** editing it and saving makes it active again for everyone invited.
- **Meetings list:** each row now has **Edit** (or **Reschedule** for a cancelled one) and **Delete**.
- A meeting that has already started still cannot be edited or cancelled (it can be deleted).

**Tests:** meeting tests updated for the new rules (delete upcoming / past, reschedule cancelled, school isolation still refused); new check that deleting an extra-class meeting unlinks the support record; full suite 698 passing; lint clean; build passing. **Migrations:** none.

---

## 1 Oct 2026 — Diya Jadhav's password; admin corrects emails; photos only by their owner

**Asked:** set Diya Jadhav's password to `SchoolOS@2026`; the School Admin must not change anyone's profile photo, but must be able to edit people's details including a mistyped email.

**Done:**
- **Password:** set for **Diya Jadhav** (student, Green Valley Academy, `diyajadhav@gmail.com`) only, on the live database; her unused links were cancelled and she was signed out; recorded in the audit log. Verified the new password works. (The bulk change for all students was not done.)
- **Email correction (School Admin):** correcting the email of a **teacher, parent, staff member or student (Class 6–12)** now also moves their **sign-in address**. Links already sent to the wrong address stop working; if the login was not activated yet, a new activation link goes to the corrected address. An address used by another account is refused and nothing changes. A person with a login cannot have their email emptied (staff saved without an email keep their sign-in address). Student edit form has a new "Student email (sign-in)" field for Class 6–12. Every change is in the audit log ("LOGIN_EMAIL_CHANGED"). Previously parents' and staff members' sign-in addresses did not change at all, and teachers' old links kept working.
- **Photos:** only the person changes their own photo (enforced on the server). The admin's student / teacher / parent / staff pages show the photo view-only.

**Tests:** new `email-correction` suite (6); photo tests updated (the admin is now refused); full suite 698 passing; lint clean; build passing. **Migrations:** none.

**Open:** Nursery–5 students have no login, so no one can now set their photo. If wanted, a parent could be allowed to set their own child's photo.

---

## 1 Oct 2026 — Photos in people lists; bulk student password (not done)

**Asked:** set every student's password to one shared password; show profile photos in the admin's student, teacher and staff lists, and for teachers too.

**Done:**
- Photos (or initials when there is none) beside each name in the admin's **Students**, **Teachers** and **Staff** lists, on the **teacher's class roster** (replacing a raw image that could show a broken icon), and in the header of the **teacher's student page**. One query per list (`photoUrlsFor`); each image is still permission-checked when loaded.
- Tested on a throwaway database with photos: all five screens show the right photo; the teacher can load their students' photos; a 2,433-page crawl found 0 errors. Full suite 692 passing.

**Not done — bulk password change:** Claude Code's safety check blocked setting all student passwords on the live database; nothing was changed. Only 5 students have logins (Green Valley 2, Sunrise 3); the other 11 have no login, so no password can be set for them. Waiting on the user's decision (see the reply of 1 Oct).

**Migrations:** none.

---

## 1 Oct 2026 — Profile check, glitch sweep, this log

**Asked:** check the profile works everywhere; find glitches; keep a project log and update it after every request.

**Done:**
- The `StudentLeave does not exist` error was from before the migration was applied; the table exists on Neon. Restart `npm run dev` if the old error still shows.
- **Glitch sweep:** ran the production build against a throwaway database and followed every link for School Admin, Teacher, Parent, Student, Librarian and Super Admin — **2,433 pages, 0 server errors, 0 error screens, 0 broken links**.
- **Profile photos:** each role's photo shows in the header and sidebar, on their own profile page, and on the admin's teacher / student / staff / parent pages; Super Admin (no photo) shows initials. Photo privacy checked: parents and students see only their own teachers' photos (and a parent their own child's), never staff or admin photos.
- Read-only health check of the live data found the setup gaps listed above.
- Created this log.

**Migrations:** none. **Code changes:** none (checks only).

---

## 30 Sep 2026 — Migration applied to Neon ("do fix")

**Asked:** fix `BookCopy` / `StudentLeave` / `School.libraryLoanDays` does not exist.

**Done:** applied `20261005090000_library_copies_student_leave` to Neon. Verified: schema matches the code; Green Valley's 11 books got 11 copies (BK-0001…BK-0011); no existing data changed.

---

## 30 Sep 2026 — Library book issue, profile photos, student leave

**Asked:** three improvements — librarian book issue with physical copies; profile photos for every user; a simple student leave system.

**Root cause (library):** Green Valley's librarian had "View library" but not "Run the library" ticked, so the page was read-only.

**Done:**
- **Library:** a Librarian now always runs the library (and nothing else — fees, students, transport stay refused). Books have numbered copies (BK-0001…); Issue Book = search student (name, admission no., "9-A", stream) → book → available copy → today → due date from the school's loan period. A copy can never be issued twice (tested with two issues at once). Checks: same school, current student, copy of that book, borrowing limit. Issued Books list with class, copy, Issued / Overdue / Returned and Return button; returning frees the copy; a returned book is never overdue. **Library rules** card (loan days, books per borrower, fine per day). Book page lists copies and who has each. Student "My Library" and parent child page show copy and status.
- **Profile photos:** "Profile photo" card on teacher, staff, parent and student profile pages (Account page already had it); photo in header and sidebar with initials fallback; size check 64–6000 px added to the existing type (by file content) and 2 MB checks; tighter visibility (parents/students only see their own teachers).
- **Student leave:** parent applies for any child (Nursery–12), student with login optionally for self; reasons Sick / Family function / Medical appointment / Personal / Travel / Other (custom); no end-before-start, no overlap, configurable back-dating (default 7 days). Class teacher of the student's current class approves / rejects with comment; admin sees all and can decide or overturn. Notifications to teacher, parent and student. Register shows **"On leave · reason"**, never changes a mark by itself, warns when the day was already marked. Pages: parent Leave, student My Leave, teacher Student Leave, admin All Student Leave Requests.

**Migration:** `20261005090000_library_copies_student_leave` (BookCopy, BookIssue.copyId, School library settings, StudentLeave) — applied to Neon later the same day.

**Tests:** new suite (20 tests); two older staff tests changed to use "Office staff" (the Librarian role now implies library access); full suite 692 passing; production smoke test of 19 pages.

**Note:** "Librarian always runs the library" is a deliberate exception to the earlier rule that a job title grants nothing by itself.

---

## 30 Sep 2026 — Substitutes: dashboard only

**Asked:** don't show concerns to substitute teachers; only the students' own teacher sees them. The substitute should just see "today I cover this class, this subject, at this time".

**Done:** removed substitute access to concerns and support. The existing "Today's substitute classes" dashboard card (time, class, subject, covering for) is what the substitute sees. Parent concerns during a teacher's leave still go to that teacher. Admin sees "On leave today" next to a teacher on approved leave.

**Tests:** admin assigns a substitute → period on their dashboard, no concern/support access → admin removes → period gone. **Migrations:** none.

_(Replaces the short-lived version below where substitutes could act on concerns during cover.)_

---

## 30 Sep 2026 — Teachers act only for students they teach

**Asked:** a teacher must not send a concern or support for another teacher's students; consider timetable and substitute availability.

**Done:** one rule for concerns **and** support — only the subject teacher of the student's class / section / stream (a class teacher only for general, non-subject support). Support was previously section-wide and let class teachers add any subject; fixed. Teachers' forms list only their own students and subjects. (A substitute-cover access rule added here was removed in the next entry at the user's request.)

**Migrations:** none.

---

## 30 Sep 2026 — Simple subject-wise concerns

**Asked:** make concerns simple — no chat. Parent → child → subject → concern; teacher raises only for own subject; statuses Open / In progress / Resolved; admin "Request Action"; seven test scenarios.

**Done:** thread UI removed (concern + short status history only); parents read-only; teacher form picks from "student — subject" pairs (subject set automatically); admin "Student Concerns" table with filters; exact messages from the brief ("…submitted to the School Admin because no teacher is currently assigned…", "School Admin requested an update for Rahul's Mathematics concern").

**Tests:** all seven scenarios (Rahul/Amit/Ravi) pass. **Migrations:** none.

---

## 30 Sep 2026 — "Subject-wise concerns not working" (Sankeswar)

**Found:** the feature worked (Green Valley's concerns reached the right teachers); Sankeswar had no subject assignments, no parent logins and no activated teachers.

**Done:** admin concerns page shows a warning with a link when no subject teacher is assigned this session.

---

## 30 Sep 2026 — Gmail SMTP for email

**Asked:** use Gmail SMTP credentials; fix "email provider is in test mode" errors.

**Done:** added SMTP delivery (nodemailer), used when `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` are set; clearer SMTP error messages; SMTP settings added to `.env` and documented in `.env.example`.

**Open:** Gmail rejected the App Password (`535`). Create a new one. The credentials pasted in chat (Gmail, Cloudinary, JWT, cron) should be rotated.

---

## 30 Sep 2026 — Activation emails, streams and seat capacity, subject-wise concerns

**Asked:** fix activation emails; admission numbers; class / section / stream structure with per-section stream seat allocation; stream-aware teacher assignments; parent–teacher concerns.

**Root cause (email):** Resend was in test mode (sender `onboarding@resend.dev`), which delivers only to the account owner — so "forgot password" to yourself worked and activation to others did not. The failure reason was being discarded.

**Done:**
- Email: the provider's reason is stored and shown on each person's page ("Activation email: failed — …") with **Resend activation**; `EMAIL_FROM` accepted; activation email names the role and school.
- Streams: a section's seats can be split among streams (e.g. Science 15 / Commerce 10 / Arts 10 / Agriculture 5), each section independent, never above capacity; admission, CSV import, promotion and section moves all claim seats under a lock; lowering a share warns and never moves students.
- Teacher assignments can be for one stream or the whole section.
- Concerns: routed to the teacher of the child's class + section + stream + subject, else the School Admin; numbered `CON-n`; admin filters and update requests.
- Admission numbers (`ADM-YYYY-00001`) and Nursery–5 account rules were already in place and re-verified.

**Migration:** `20261004090000_streams_concerns` (SectionStream, stream on assignments, reworked SupportConcern + ConcernMessage) — applied to Neon.

---

## Before 30 Sep 2026 (from earlier notes)

- **Phases 1–11** (done by 20 Sep): foundation, schema, auth/RBAC, marketing site and registration, Super Admin platform, academic setup and people, timetable, attendance and reports, notices and events, public school website and admissions, dashboards for every role; then a REST API (`/api/v1`) and chart dashboards.
- **26 Sep:** fees, expenses, salaries and finance overview; teacher lesson PDFs and resources.
- **27 Sep:** holidays and weekly offs.
- **28 Sep:** printable fee receipts; large-school round (exams and report cards, leave and cover, bulk student tools, targeted notices, alert feeds, payroll, complaints, audit log, timetable rooms, non-teaching staff, transport, library, inventory); PTM replaced by invitation-only **Meetings**; **NON_TEACHING_STAFF** logins with per-person permissions; fees shown to parents only.
- **28–29 Sep:** UX simplification, colourful theme and dark mode, Hindi / English.
- **29 Sep:** people lifecycle (status history, login follows status); student support ("needs attention").
- **Late Sep:** core workflows (setup checklist, staff leave, voiding fee payments, staff permissions, read state for alerts); attendance registers (class teacher only, drafts, 2-hour correction window, register cover); staff attendance; accounts and admissions (activation-email logins, `ADM-YYYY-00001`, profile photos).

Migrations for all of the above are in `prisma/migrations` and applied to Neon.
