# SchoolOS — Architecture

Audience: engineers working on this repository.

One Next.js application, one PostgreSQL database, many schools. Adding a
school is a row in `School`, never a branch or a deployment.

---

## 1. Tenancy model

### How a school is identified

A request resolves to a tenant in one of three ways, in this order:

| Stage | Form | Resolution |
| --- | --- | --- |
| V1 (now) | `/schools/abc-public-school` | path segment → `School.slug` |
| Later | `abc.schoolos.app` | `Host` header label → `School.subdomain` |
| Later | `www.abcschool.com` | `Host` header → `School.customDomain` |

All three land on the same route tree. `proxy.ts` rewrites host-based
requests onto the `/schools/[slug]` tree, so adding subdomain and custom-domain
support later touches one file, not the app.

### The rule that matters

**Tenant identity for authorization always comes from the session row in the
database — never from the URL, the request body, or a hidden form field.**

The slug in the URL selects which *public* school website to render. It never
grants access to anything private. A signed-in user's `schoolId` is read from
their session, which is read from the database on every request.

### Two layers of enforcement

**Layer 1 — the scoped client.** `requireTenant()` (pages),
`requireTenantForAction()` (Server Actions) and `apiRoute()` (REST) each build a
`TenantContext` whose `db` is `forSchool(session.schoolId)` —
`src/server/tenancy/scope.ts`. That Prisma extension adds
`where.schoolId` to every read, update, delete, count, aggregate and groupBy,
and `data.schoolId` to every create, for each model named in `TENANT_MODELS`.
An operation it does not know how to scope throws rather than running
unscoped. A `schoolId` smuggled into a `where` is kept as an *extra* filter, so
asking for another school matches nothing instead of being silently rewritten.

`TENANT_MODELS` must list **every** model that has a `schoolId` column. A model
left off it is not filtered at all — which is exactly the gap the 26 Sep 2026
audit found for ten finance, assessment and lesson-material models (see
[`AUDIT.md`](AUDIT.md) §10). The unscoped `prisma` client is used only where
there is no tenant: platform (Super Admin) code, authentication, the public
school website (filtered by the `schoolId` resolved from the slug) and the
public admission form.

**Layer 2 — composite foreign keys in PostgreSQL.** Every school-owned table
carries `schoolId` and declares:

```prisma
@@unique([schoolId, id])
```

Every relation between two school-owned tables then references the *composite*
key rather than the bare id:

```prisma
// Section belongs to a Class — and both must belong to the same School.
class    Class  @relation(fields: [schoolId, classId], references: [schoolId, id])
```

The consequence: PostgreSQL itself rejects a `Section` row that points at
another school's `Class`. Cross-tenant grafting is not merely unauthorized, it
is unrepresentable. A forgotten `where: { schoolId }` in one query site becomes
a read bug, not a data-corruption breach.

### Tenancy map

Every model, and how it is tied to one school. "Scoped" means listed in
`TENANT_MODELS`; "composite FK" means its links to other school-owned rows use
`(schoolId, id)`, so PostgreSQL rejects a cross-school link.

| Model | Tenancy path | Scoped | Composite FK |
| --- | --- | --- | --- |
| `School` | is the tenant (scoped by `id`) | by id | — |
| `AcademicSession`, `Class`, `Stream`, `Section`, `Subject` | own `schoolId` | yes | yes |
| `Teacher`, `Student`, `Parent` | own `schoolId`; `userId → User` | yes | yes (except to `User`) |
| `StudentEnrollment`, `ParentStudent`, `TeacherSubjectAssignment`, `ClassTeacherAssignment` | own `schoolId`; both ends in the same school | yes | yes |
| `TimetableSlot`, `ClassSession`, `StudentAttendance`, `TeacherAttendance` | own `schoolId` | yes | yes |
| `Homework`, `StudentRemark`, `Assessment`, `AssessmentResult`, `LessonMaterial` | own `schoolId` | yes | yes |
| `FeeHead`, `FeeCharge`, `FeePayment`, `Expense`, `TeacherSalary`, `SalaryPayment` | own `schoolId` | yes | yes |
| `Notice`, `Event`, `AdmissionApplication`, `SchoolPage`, `SchoolMedia`, `Subscription` | own `schoolId` | yes | yes |
| `User` | `schoolId` nullable (Super Admin has none) | yes | n/a |
| `ApiToken` | `schoolId` nullable, copied from its owner | yes | n/a |
| `Session` | through `User` | no — read only by the auth layer, by token hash | — |
| `AuditLog` | `schoolId` nullable | no — read only by Super Admin | — |
| `EmailVerification` | `schoolId` nullable | no — registration only, by reference | — |
| `Plan`, `PlatformOffer`, `PlatformInquiry` | platform-level, no school | no | — |

The only single-column links between tenant rows are to `User`
(`Teacher.userId`, `recordedById`, `authorId`…), because `User.schoolId` is
nullable. They are safe because no request ever supplies a user id to link:
every one is either the signed-in user or an account created in the same
write, through the scoped client.

### Why not row-level security

Postgres RLS is the stronger primitive, but with Prisma it requires every query
to run inside an explicit transaction that issues `SET LOCAL app.school_id` on a
pinned connection. That defeats connection pooling on serverless and complicates
every call site. The composite-key design gives most of the structural guarantee
at no runtime cost, and RLS can be layered on later without reshaping the schema.

---

## 2. Roles and authorization

`SUPER_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`,
`NON_TEACHING_STAFF`.

`NON_TEACHING_STAFF` is a login for a `StaffMember` (accountant, driver,
librarian…). It is never a School Admin, whatever the designation: the staff
portal (`/staff`) shows their own record, whole-school notices for everyone or
for staff, and meetings they are invited to. Anything more is a read-only module
the admin grants in `StaffMember.permissions` (`VIEW_STUDENTS`, `VIEW_LIBRARY`,
`VIEW_TRANSPORT`), checked from the database on every request by
`server/auth/staff-access.ts` — in the page guard and again in the service.

`SUPER_ADMIN` is the only role with `schoolId = null`; it governs the platform
(approving schools, subscriptions, audit logs, homepage offers) and does not
participate in day-to-day school operations. Every other role is bound to
exactly one school.

That separation is enforced, not just a matter of which screens exist. A
Super Admin has no `schoolId`, so every school page redirects them and every
school API answers 403. Their dashboard shows schools as accounts (status
counts, the school list with size and owner details, review, suspension,
admins, plans, offers) and the audit trail they read is filtered to
`PLATFORM_AUDIT_ACTIONS` plus their own actions (`PLATFORM_AUDIT_WHERE` in
`server/platform/audit.ts`). A school's attendance, homework, marks, fees,
salaries and remarks stay in the log for the school but never appear on a
platform screen.

Every protected entry point answers five questions in order:

1. Is there a valid, unexpired session?
2. Is the user's role permitted to perform this operation?
3. Is the user's school active (not suspended, not pending)?
4. Does the target resource belong to that same school?
5. For teachers — is this one of their assigned sections?

Question 4 is answered by *scoping the query*, not by fetching the row and
comparing afterwards. A cross-tenant read returns "not found" rather than
"forbidden", so the API never confirms that another school's record exists.

### Sessions

Opaque random tokens stored in a `Session` table, referenced by an
`httpOnly` + `Secure` + `SameSite=Lax` cookie. Not JWTs.

The reason is revocation. When a Super Admin suspends a school, every session
belonging to that school must die immediately — a stateless token cannot be
withdrawn before it expires. A database-backed session is deleted and the next
request is rejected.

`proxy.ts` (Next 16 renamed Middleware to Proxy) performs only an optimistic
cookie-presence check to redirect signed-out visitors. The Next.js docs are
explicit that proxy is not a session or authorization layer; real verification
happens in the data access layer on every request.

The guards use `redirect()` and `notFound()` rather than Next's `unauthorized()`
and `forbidden()`, which still require the experimental `authInterrupts` flag.
The core authorization path of a production system should not depend on an
experimental toggle. The behaviour is also better: a signed-out visitor reaches
the login form, a signed-in user who lacks a role is sent to their own dashboard
(so probing `/super-admin` reveals nothing), and a record belonging to another
school renders the 404 page — indistinguishable from one that does not exist.

Passwords are bcrypt, cost 12. The login path runs a dummy comparison when an
email is unknown, so response timing does not reveal which addresses exist.

---

## 3. Academic structure and historical integrity

```
AcademicSession (2026-27)
  └── Section ("A", of Class 11, stream Science)
        └── StudentEnrollment
              └── Student
```

`Class` covers Nursery, LKG, UKG and Classes 1–12, ordered by an integer
`level` so sorting never depends on parsing names. Streams are optional and
school-defined; the three common ones are seeded, and a school may add its own.

### Student vs. StudentEnrollment — a deliberate deviation

The brief lists `classId`, `sectionId` and `academicSessionId` as fields *on*
`Student`. We split them out instead:

- `Student` is the **person**: name, date of birth, admission number, photo.
  Stable for as long as they attend the school.
- `StudentEnrollment` is the **placement**: one row per student per academic
  session, holding class, section, stream, roll number and status.

Storing placement on `Student` would mean promoting a child from Class 9 to
Class 10 *overwrites* the record of them ever having been in Class 9 —
directly contradicting the requirement that historical academic records remain
intact and that promotion be supportable later. With enrollments, promotion is
an insert, last year's attendance still resolves to last year's class, and
"Class 10-A in 2025-26" and "Class 10-A in 2026-27" are distinct cohorts.

Queries that want the flat shape read the enrollment for the active session.

---

## 4. Route structure

```
src/app/
  (marketing)/              # schoolos.app — the SaaS product site. Not a school.
  (auth)/login
  (platform)/super-admin/...  # SUPER_ADMIN only
  (app)/school-admin/...      # SCHOOL_ADMIN
  (app)/teacher/...
  (app)/student/...
  (app)/parent/...
  (app)/staff/...             # NON_TEACHING_STAFF
  (public)/schools/[slug]/  # a school's public website — no auth, no private data
  api/...
```

Route groups exist so each audience gets its own layout and its own guard in
one place. The root homepage belongs to the platform; a school's homepage lives
under `/schools/[slug]`.

Each area's `layout.tsx` draws the shell and checks the role, but a layout is
*not* the authorization boundary: layouts do not re-run when the router moves
between sibling pages. Every page repeats its own `requireTenant()` /
`requireSuperAdmin()` call, which is cached per request and therefore free.

---

## 5. Directory layout

```
src/
  app/          route tree only — thin; no business logic
  components/
    ui/         shadcn primitives
    shared/     cross-feature components
  components/
    forms/      ActionForm + fields bound to Server Actions
  features/     per-area Server Actions and the Client Components they feed
  server/       'server-only' — the data access layer
    auth/       password hashing, sessions, RBAC, one-time passwords
    tenancy/    requireTenant() and scoped query helpers
    academics/  sessions, classes, sections, subjects, provisioning
    people/     students, guardians, teachers, and each role's own view
    attendance/ registers, staff attendance, reports
    timetable/  weekly periods and clash checks
    classwork/  what a teacher records: lesson records, homework, remarks
    admissions/ public applications and their review
    communication/ notices and events
    website/    the school's public site, read and edit sides
    platform/   Super Admin governance: schools, plans, offers, audit
    db/         Prisma client singleton
    audit/      audit log writer
  lib/          isomorphic helpers: env, errors, action results, Zod schemas
  types/
prisma/         schema, migrations, seed
tests/
  unit/         pure logic
  integration/  database-backed, including the cross-tenant isolation suite
```

Server Actions stay thin: validate input with Zod, call a `src/server/` function,
return an `ActionResult`. Authorization lives in the data access layer, so it
cannot be skipped by adding a new caller. Every action ends in
`performAction()`, which normalises errors, revalidates the affected routes and
— only on success — navigates.

Each service function re-asserts the roles it serves with `assertRole()`, even
though its callers already passed a guard. A Server Action is a public POST
endpoint; the page that renders its form protects nothing.

---

## 6. Authorization beyond the tenant

Tenant scoping answers "is this the right school?" — never "is this *your*
record?". Three checks answer the second question, and all three live in the
data access layer rather than in the screens:

| Question | Where |
| --- | --- |
| May this teacher touch this section? | `teacher-access.ts` — a subject assignment or class-teachership |
| May this teacher set work in this subject? | `teacher-access.ts#requireSubjectAssignment` — the assignment itself; class-teachership is not enough |
| May this guardian open this child? | `portal.ts#requireChildOfParent` — the `ParentStudent` link |
| May this teacher still change this register? | `attendance/service.ts` — today and the last 7 days; admins any day in the session |
| May this teacher still write up this lesson? | `classwork/activities.ts` — the same seven days, so a register and its lesson record age together |
| May this teacher change *this* homework or remark? | `classwork/` — authorship. A colleague teaching the same class may read it and not edit it |
| May this teacher write up a period that is not theirs? | `classwork/activities.ts` — only if the office named them the stand-in for that date. `assignSubstitute` is the School Admin's to call |
| May this parent open this child? | `portal.ts#requireChildOfParent` — the `ParentStudent` link. A parent writes nothing |
| May this staff member open this module? | `staff-access.ts#assertAdminOrStaffPermission` — `StaffMember.permissions`, read per request; the designation grants nothing |
| Is this user invited to this meeting? | `communication/meetings.ts#visibleMeetingWhere` — their group, their (children's) sections, or a named invitation |

Timetabling a teacher for a period also assigns them that subject in that
section, so the right to mark a register follows from the timetable rather than
being granted twice.

## 7. Forms and validation

Zod schemas in `src/lib/validation/` are the single source of truth, used by
both the client form and the Server Action that receives it. Forms use React 19
`useActionState` with Server Actions rather than a client form library.

Every action returns `ActionResult`, a discriminated union carrying either a
success message or a user-safe error plus per-field messages. `runAction()`
converts thrown errors into that shape: `AppError` subclasses expose their
message, anything else is logged server-side and replaced with a generic string,
so database errors and stack traces never reach a browser.

---

## 8. The public side

Three route groups are readable without signing in, and none of them can reach
private data:

* `(marketing)` — the platform's own site and school registration. A
  registration is a `School` row in PENDING status plus the administrator's own
  account, with the password they chose. Neither grants anything: sign-in
  refuses every school that is not ACTIVE, and so does session validation on
  each later request, so the account is dormant until the school is approved.

  Getting a school onto the platform takes three steps, in this order:

  1. **Register.** The form takes the school's details, the contact's, and the
     password that contact will sign in with. It creates the PENDING school and
     their `SCHOOL_ADMIN` user in one transaction, and emails a six-digit code
     to the contact address. An email already in use is refused here rather
     than at approval time, when it would be far more annoying.
  2. **Verify that address.** Until `contactEmailVerifiedAt` is set, approval
     is refused — otherwise anyone could register a school in someone else's
     name and have it approved for them. The code is stored only as a SHA-256
     hash, expires in ten minutes, is consumed on use, dies after five wrong
     guesses, and resending is throttled. Wrong, expired, consumed and "no such
     registration" all answer identically.
  3. **Approval.** The Super Admin approves; that provisions the school and
     emails the contact to say they can sign in. Only now does their account
     work, because `validateSessionToken` refuses every school that is not
     ACTIVE. (A password is generated and shown once *only* when the school has
     no administrator yet — a Super Admin adding one by hand.)

  Someone who signs in before approval is told so — "waiting for approval",
  "suspended" — rather than "incorrect password". Their password was right;
  being vague there would only confuse the person who owns the account, and
  tells an attacker nothing they could not already see.

  A Super Admin can mark an address verified by hand for a school that
  confirmed itself another way. It is audited with their name, because it
  bypasses the proof everyone else gives.
* `(public)/schools/[slug]` — a school's website. Only ACTIVE schools render,
  and the query selects public columns only, so a suspended school is a 404 to
  the outside world.
* The admission form. An application is inert contact data; the student,
  guardian and enrollment rows are written only when an administrator accepts
  it, in one transaction.

Both public forms carry a honeypot field and a per-IP rate limit, and answer a
bot exactly as they answer a person.

School-authored text (notices, pages, the about section) is stored as plain
text with a small Markdown subset and rendered by `RichText`, which builds
React elements and never sets HTML. A school admin cannot inject script into
their own public site, and `[link](…)` accepts only http(s) and site-relative
addresses.

## 9. The REST API

`/api/v1` exposes the same service layer the screens use, for mobile apps,
scripts and integrations. See [`API.md`](API.md) for the endpoint reference.

Route Handlers are not covered by any page guard, so `src/server/api/handler.ts`
is the only thing standing between a request and the data. Every route goes
through it, and it is where authentication, the role check, tenant scoping,
read-only enforcement, CSRF and the error shape live — once, rather than in
sixty route files.

Two credentials resolve to the same thing, a `SessionUser`: the session cookie,
and a bearer `ApiToken`. **A token acts as the user who created it.** It holds
no role of its own, so it cannot exceed that person, and it is validated on
every request against the same rules as a session — deactivate the owner or
suspend their school and the token stops working immediately. Only its SHA-256
hash is stored. Tokens may be `READ`, which is refused on every unsafe method.

Bodies are validated with the *same* Zod schemas the web forms use, so the two
front doors cannot drift into disagreeing about what is valid. Where an id
appears in both the path and the body, the path wins, so a forged body cannot
redirect a write to another record.

---

## 10. Dashboards and charts

Every role lands on a dashboard built from the same parts: a KPI row, charts
from `src/components/charts/`, and lists. The aggregates live in
`src/server/analytics/` and run through `ctx.db`, so a dashboard can only ever
summarise its own school — the Super Admin's is the exception, and it counts
tenants rather than reading inside them.

The charts are **Server Components that emit SVG**. No charting library, no
client JavaScript: hover tooltips are CSS (`group-hover`) on a hit target per
data point, with `<title>` and `tabIndex` so the same information is reachable
by keyboard and screen reader.

Three decisions worth keeping:

* **The palette was computed, not chosen.** The accent and the ordinal ramp are
  steps of the brand hue, checked with the dataviz validator against this app's
  own chart surfaces (`#ffffff` light, `#171717` dark) for monotone lightness,
  step separation and contrast. `globals.css` records the results next to the
  tokens.
* **Attendance uses the reserved *status* hues, not series colours** — present
  is good, late is a warning, absent is critical — and "excused" is the
  de-emphasis grey, because an authorised absence should not alarm anyone and
  grey cannot be confused with its neighbours under any colour-vision
  deficiency. `warning` sits below 3:1 on white by design, so every chart that
  uses it ships a legend, visible labels and a table view.
* **A day with no register is a gap, not a zero.** Holidays are dropped from
  the trend rather than drawn as 0% attendance, and a single month of data does
  not become a one-column chart — the stat tile beside it already says that.

---

## 11. Email

`src/server/mail/mailer.ts` is the seam. Delivery goes through Resend when
`RESEND_API_KEY` is set — a plain `fetch` to their HTTP API, no SDK — and
otherwise each message is written to the server log, clearly marked as not
delivered, so a one-time code is readable in the terminal during development
and an unconfigured deployment is loud rather than silent.

Swapping providers is one call to `setMailTransport`; nothing above that file
changes, and the tests swap in their own transport to assert on what would
have been sent.

Sending reports whether the provider accepted the message, and that answer is
carried back to the person who asked for a code: "a new code is on its way"
and "we could not send the email" are different sentences, and the audit entry
records which one happened. Without that, a school whose address the provider
refuses would sit waiting for an email nobody could see had failed.

Sending never breaks the operation that triggered it — a school is registered,
and an account is created, whether or not the mail goes out. That is why the
Super Admin still sees a new password once on screen even though it is also
emailed.

---

## 11a. Interface: navigation, design tokens and languages

**Navigation.** Each role's sidebar (`lib/nav.ts#NAV_BY_ROLE`) is short and
named for what people do. Screens that belong together share one entry and are
reached through tabs (`AREA_TABS`) — Students/Admissions/Parents,
Teachers/Staff/Leave, Fees/Receipts, Holidays/Events, Inventory/Library/
Transport. Rare setup (academic year, website, audit log, API tokens) lives on
`/school-admin/settings`. No URL changed. On phones the sidebar becomes a
drawer and a bottom bar holds four daily destinations (`MOBILE_PRIMARY`).

**Design tokens.** Colours are defined once in `app/globals.css`: brand
(`primary`, `primary-soft`, `primary-strong`), status (`success`, `warning`,
`danger`, `info`, each with `-soft` surface and `-strong` AA text) and
surfaces, plus `purple` and `orange` accents. Use the token classes
(`bg-success-soft text-success-strong`) — never raw palette classes.
Areas have fixed colours through `components/shared/tones.ts` (students
blue, teachers purple, attendance green, money orange, warnings amber,
problems red, meetings/information cyan), used by `StatCard`,
`QuickActions`, `PageHeader` and `EmptyState` via `tone` + `icon` props.

**Dark mode.** `next-themes` (`components/theme/`) puts `dark` on `<html>`
before first paint, so there is no flash; the choice (light, dark or
follow the device) is kept in the browser. `.dark` in `globals.css` is a
designed slate theme, not an inversion. Printed documents (receipts, report
cards) sit under `.force-light`, which re-applies the light tokens, so paper
stays white in either theme. `StatusBadge` maps every status to a tone and adds
a dot and a word, so meaning never rests on colour alone. Chart colours
(`--viz-*`) are a separate, validated set.

**Languages.** English and Hindi. Dictionaries are typed objects in
`lib/i18n/messages/` (`hi` is typed against `en`, so a missing key fails the
build); keys are dot paths (`dashboard.admin.addStudent`). Server Components
call `await getT()` (`server/i18n.ts`); Client Components call `useT()`.
The language is the person's own `User.preferredLanguage`, else the
`schoolos_lang` cookie, else English; `setLanguageAction` changes only the
caller's own row and cookie and grants nothing. Only the interface is
translated — names, admission numbers and anything people wrote are shown as
entered. Dates and money take an Intl locale (`getIntlLocale()`), keeping
Indian digit grouping and ₹. To add a language: add its code to
`lib/i18n/config.ts`, a dictionary typed as `Messages`, and register it in
`messages/index.ts`. Not every page body is translated yet — the shell,
navigation, dashboards, sign-in, filters, paging, statuses and the add
student/teacher flows are; other pages fall back to English.

## 11b. People lifecycle: status, login and history

JOIN → ACTIVE → status change → access → history kept. Nobody who has been
part of the school is deleted; the existing delete buttons refuse anyone with
history and are only for records added by mistake.

* **Status** is the person's standing: `StudentStatus` (ACTIVE, ON_LEAVE,
  TRANSFERRED, GRADUATED, WITHDRAWN, INACTIVE) and `TeacherStatus`, shared by
  teachers and non-teaching staff (ACTIVE, ON_LEAVE, SUSPENDED, RESIGNED,
  TERMINATED, RETIRED, TRANSFERRED, INACTIVE). `lib/validation/lifecycle.ts`
  says which are *current* (ACTIVE, ON_LEAVE) and which mean *has left*.
  A guardian's standing is derived, never stored: ACTIVE while any child is
  current, otherwise NO_ACTIVE_CHILDREN.
* **Login** is separate: `User.isActive` plus `disabledReason` — ADMIN (the
  office closed it; stays closed) or STATUS (closed because the person left;
  reopens by itself if they return). Shown as ACTIVE / DISABLED / LOCKED.
* **Every status change** — dialog, edit form, bulk action, API — goes through
  `server/people/lifecycle.ts`, which records a `StatusChange` row (effective
  date, reason, remarks, who) for the status and for any login effect, audits
  it, and applies the consequences: a student's current-year placement leaves
  the registers and their bus place is suspended; a teacher stops being class
  teacher (dated in `ClassTeacherAssignment`) and the office is told which
  periods and subjects to hand over; a staff member leaves their bus routes.
  Earlier years, registers, lessons, homework, marks, remarks, fees and salary
  keep pointing at the person exactly as they were.
* **Enforcement is server-side, twice.** Sign-in and every session check refuse
  a student, teacher or staff member whose status is not current, whatever the
  login flag says (`session.ts#personMaySignIn`). Parent access is limited to
  current children (`parent/access.ts`, `people/portal.ts`, notice and meeting
  audiences); a sibling who is still here is unaffected.
* Lists default to current people ("Current" filter), with every other status
  and "any status" one choice away; people who have left show their leaving
  date. Dashboards count current people only; Reports shows current and former
  separately.

## 12. Deployment

Vercel for the application, Supabase or Neon for PostgreSQL. Prisma 7 talks to
Postgres through the `@prisma/adapter-pg` driver adapter, which works behind a
connection pooler without extra configuration. Every environment-specific value
is read through `src/lib/env.ts`, which validates the whole environment at
startup and fails loudly rather than yielding `undefined` at runtime.
