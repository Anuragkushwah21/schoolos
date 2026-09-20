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

**Layer 1 — the data access layer.** Every query against a school-owned table
goes through `src/server/` helpers that take their `schoolId` from
`requireTenant()`. Route handlers and Server Actions never call `prisma`
directly.

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

### Why not row-level security

Postgres RLS is the stronger primitive, but with Prisma it requires every query
to run inside an explicit transaction that issues `SET LOCAL app.school_id` on a
pinned connection. That defeats connection pooling on serverless and complicates
every call site. The composite-key design gives most of the structural guarantee
at no runtime cost, and RLS can be layered on later without reshaping the schema.

---

## 2. Roles and authorization

`SUPER_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`.

`SUPER_ADMIN` is the only role with `schoolId = null`; it governs the platform
(approving schools, subscriptions, audit logs, homepage offers) and does not
participate in day-to-day school operations. Every other role is bound to
exactly one school.

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
(so probing `/platform` reveals nothing), and a record belonging to another
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
  (platform)/platform/...   # SUPER_ADMIN only
  (app)/admin/...           # SCHOOL_ADMIN
  (app)/teacher/...
  (app)/student/...
  (app)/parent/...
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
| May this guardian open this child? | `portal.ts#requireChildOfParent` — the `ParentStudent` link |
| May this teacher still change this register? | `attendance/service.ts` — today and the last 7 days; admins any day in the session |

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
  registration is a `School` row in PENDING status; no user account exists
  until a Super Admin approves it.

  Getting a school onto the platform takes three steps, in this order:

  1. **Register.** The form creates the PENDING school and emails a six-digit
     code to the contact address.
  2. **Verify that address.** Until `contactEmailVerifiedAt` is set, approval
     is refused — otherwise anyone could register a school in someone else's
     name and have it approved for them. The code is stored only as a SHA-256
     hash, expires in ten minutes, is consumed on use, dies after five wrong
     guesses, and resending is throttled. Wrong, expired, consumed and "no such
     registration" all answer identically.
  3. **Approval.** The Super Admin approves; that provisions the school,
     creates the first administrator and emails them their sign-in. Only now
     can anyone sign in, because `validateSessionToken` refuses every school
     that is not ACTIVE.

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

## 12. Deployment

Vercel for the application, Supabase or Neon for PostgreSQL. Prisma 7 talks to
Postgres through the `@prisma/adapter-pg` driver adapter, which works behind a
connection pooler without extra configuration. Every environment-specific value
is read through `src/lib/env.ts`, which validates the whole environment at
startup and fails loudly rather than yielding `undefined` at runtime.
