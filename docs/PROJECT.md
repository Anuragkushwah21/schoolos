# SchoolOS — project handbook

What this is, how it works today, and how to keep building it.

Start here, then go deeper in [`ARCHITECTURE.md`](ARCHITECTURE.md) (why the code
is shaped the way it is) and [`API.md`](API.md) (the REST surface).
[`AUDIT.md`](AUDIT.md) records where the code stands against the intended
product and what is deliberately still open. The [`README`](../README.md) is the
short version: install, run, test.

---

## 1. What it is

One Next.js application and one PostgreSQL database serve every school.

Adding a school is a row, not a deployment. A school registers on the marketing
site, verifies its email, and is approved by the platform owner; from then on
its administrator runs the school — people, timetable, attendance, admissions,
notices and its own public website — and its teachers, students and guardians
each sign in to their own view.

**The rule that shapes everything:** a school can never see another school's
data. Not "the screens don't show it" — the database refuses to link two
schools' records at all. Every school-owned table carries `schoolId` and every
relation between such tables is a composite foreign key on
`(schoolId, parentId)`. A forgotten `where` is a read bug, not a breach.

---

## 2. The map

```
src/
  app/                  routes only — thin, no business logic
    (marketing)/        schoolos.app: homepage, registration, email verification
    (auth)/login
    (platform)/         SUPER_ADMIN — governs schools, never reads inside them
    (app)/school-admin|teacher|parent|student   each role's own dashboard
    (account)/          account settings and API tokens, shared by every role
    (public)/schools/[slug]/   a school's own website
    api/v1/             the REST API (71 route files)
  features/<area>/      Server Actions + the Client Components they feed
  components/
    ui/                 shadcn primitives
    forms/              ActionForm and the fields that read its state
    charts/             server-rendered SVG charts
    shared/             cross-feature pieces
  server/               'server-only' — the data access layer
    auth/  tenancy/  academics/  people/  attendance/  timetable/
    classwork/  parent/  student/  finance/  admissions/
    communication/  website/  platform/  analytics/  mail/  api/
    audit/  db/
                          classwork/ holds what a teacher records and the
                          School Admin's substitute cover
  lib/                  isomorphic helpers: env, errors, dates, validation
prisma/                 schema (39 models), migrations, development seed
tests/                  unit + database-backed integration
scripts/                one-off operational scripts
```

Roughly: **`app` asks, `features` validates, `server` decides, Postgres
enforces.**

---

## 3. The life of a school

This is the spine of the product. Everything else hangs off it.

1. **Register** (`/register`). The form also asks for the password the
   administrator will use. It creates the `School` row with status `PENDING`
   and their account, and emails a six-digit code to the contact address. The
   account cannot be used yet.
2. **Verify** (`/register/verify`). The code proves the registrant can read
   that inbox. It is stored only as a hash, expires in ten minutes, dies after
   five wrong guesses, and resending is throttled.
3. **Approve** (Platform → Schools). Refused until the email is verified.
   Approving provisions the school — classes Nursery–12, streams, subjects and
   the current academic session — and emails the contact to say they can sign
   in. Signing in lands them on their role's dashboard.
4. **Set up.** The administrator adds sections, staff and students, builds the
   timetable, and issues logins to teachers, students and guardians.
5. **Daily use.** Teachers mark registers; the admin watches attendance,
   admissions and notices; parents and students see their own record.

Nobody can sign in until the school is `ACTIVE`: session validation re-checks
the school's status on *every* request, which is also why suspending a school
signs everyone out on their next click. Someone who tries early is told what
is actually happening — waiting for approval, suspended — not that their
password is wrong.

---

## 4. Who sees what

| Role | Their view | The boundary that holds it |
| --- | --- | --- |
| Super Admin | Every school's *governance* — status, contacts, plan, counts | Has no `schoolId`; never reads a school's students or staff |
| School Admin | Everything inside one school | `schoolId` comes from their session row, never the URL |
| Teacher | Their own classes, timetable, registers, lesson records, homework and remarks | A subject assignment or class-teachership; being in the school is not enough |
| Parent | Their own children only, read-only | The `ParentStudent` link, re-checked on every read in `server/parent/`. One login covers every child linked to it |
| Student | Their own day, lessons, material, homework, marks, attendance, remarks | Starts from `ctx.user.id`. The only id any student read takes is a lesson's, checked against their own section |

Two more constraints worth remembering: teachers may mark attendance for today
and correct the last seven days (an admin may correct any day in the session),
and every student in a submitted register must actually be enrolled in that
section — a forged id fails the whole save.

Inside the teacher's own area the boundary tightens twice more. Class-teachership
opens a register but not a subject: setting homework needs the subject assignment
for that section. And authorship, not colleagueship, governs editing — homework,
lesson records and remarks may be read by every teacher of that class and changed
only by the one who wrote them.

---

## 5. How to build the next feature

Every existing module follows the same path. Follow it and the guarantees come
for free; step outside it and you are on your own.

1. **Schema** — add the model or column in `prisma/schema.prisma`. If it is
   school-owned, give it `schoolId`, `@@unique([schoolId, id])` and composite
   relations. Then `npm run db:migrate` (local) or `db:deploy` (real).
2. **Validation** — a Zod schema in `src/lib/validation/`. The *same* schema
   serves the web form and the API, so the two can never disagree about what
   is valid.
3. **Service** — a function in `src/server/<area>/` that takes `ctx`
   (`TenantContext`) and does the work. Start it with `assertRole(...)`, query
   through `ctx.db`, and throw `AppError` subclasses for anything the user
   should read. Write to the audit log for anything consequential.
4. **Action** — a `"use server"` function in `src/features/<area>/` that
   re-checks the caller (`requireTenantForAction`), parses with
   `parseFormData`, calls the service, and ends in `performAction` for error
   shaping, revalidation and redirects.
5. **UI** — a page in `src/app/` that calls its own guard and stays thin, plus
   an `ActionForm` with the field components.
6. **API** — a route file under `src/app/api/v1/` using `apiRoute` /
   `platformRoute` / `publicRoute`, reusing the same service and schema.
7. **Test** — an integration test in `tests/integration/`. The ones that earn
   their keep assert *refusals*: another school's id, the wrong role, a forged
   field, a limit exceeded.

Conventions that are not obvious:

- A Server Action and a Route Handler are public POST endpoints. The page that
  renders the form protects nothing, so each one re-checks its own caller.
- A layout does not re-run on client navigation, so layouts draw chrome but
  never authorize; every page repeats its guard (they are request-cached, so
  this is free).
- School-authored text is rendered through `RichText`, which builds React
  elements and never sets HTML.
- Money is integer paise; a time of day is minutes from midnight; a calendar
  day is a UTC-midnight `Date`, and "today" is computed in the school's zone.

---

## 6. Running it

```bash
npm install
cp .env.example .env     # fill DATABASE_URL and SESSION_SECRET
npm run db:deploy        # apply migrations
npm run dev
```

**Know which database you are on.** `.env` holds exactly one uncommented
`DATABASE_URL`; with two, the winner depends on load order and you will not
notice until you have written to the wrong one.

| | Local cluster | Real database (Neon) |
| --- | --- | --- |
| Start | `npm run db:start` | — |
| Migrate | `npm run db:migrate` | `npm run db:deploy` |
| Demo data | `npm run db:seed` | refused — the seed wipes every table first |
| Reset | `npm run db:reset` | never |

A fresh database has no accounts, and nothing can happen without a platform
owner:

```bash
npx tsx scripts/create-super-admin.ts you@example.com "First" "Last"
npx tsx scripts/seed-plans.ts        # the three subscription tiers, idempotent
```

Tests always use `.env.test` and refuse to run against anything but the local
`schoolos_test` database, so `npm test` can never touch real data.

**Email** goes through Resend when `RESEND_API_KEY` is set, and is otherwise
written to the server log, clearly marked as undelivered. Until a domain is
verified at resend.com/domains, Resend only delivers to the address that owns
the account — every other registration generates a code that never arrives.
That failure is visible: it is logged, recorded in the audit entry, and the
person asking for another code is told.

Checks before pushing:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

---

## 7. What is built

| Area | State |
| --- | --- |
| Tenancy, auth, RBAC, sessions, audit log | Done |
| Registration → email verification → approval | Done |
| Academics: sessions, classes, sections, streams, subjects | Done |
| Students, guardians, teachers, portal logins | Done |
| Timetable with clash checks | Done |
| Attendance (students + staff) and reports, CSV export | Done |
| Notices and events | Done |
| Admissions: public form → review → admit | Done |
| A school's public website + its editor | Done |
| Dashboards for all five roles, with charts | Done |
| Teacher classwork: lesson records, homework, remarks | Done, UI only |
| Substitute cover: assign, and let the stand-in record the class | Service only |
| Parent portal: today, attendance, timetable, activity, homework, results, remarks, reports, alerts | Done |
| Student portal: today's classes, completed lessons with notes and material, upcoming lessons, homework, tests, attendance, remarks, progress | Done |
| Lesson notes, important points, study material and lesson planning (teacher side) | Done |
| Loading states: route skeletons, button spinners, sign-in and sign-out | Done |
| Auth-aware public header with a role-based menu | Done |
| Teacher employment record and effective-dated salary | Done |
| Fees: configurable heads, per-student charges, receipts, collection screen | Done |
| Parent fee summary and payment history | Done |
| Parents as families: search, details dialog, mandatory on admission | Done |
| Assessments and marks | Read side done; no teacher entry screen |
| REST API `/api/v1` with bearer tokens | Done |

Today: 96 pages, 79 API routes, 39 models, 294 tests.

"Done, UI only" means the module is complete behind the screens a teacher uses
but has no `/api/v1` routes and is not yet surfaced to students or guardians —
see the next section.

---

## 8. What is not built, and what to do next

[`AUDIT.md`](AUDIT.md) §8 is the live list, ordered by what blocks the most —
the parent portal first. What follows is the longer view: features deliberately
left out of V1 rather than started and abandoned. Rough order of value:

1. **Verify a mail domain.** Until then only one address receives email, which
   caps registration at one real school. Smallest change, largest unlock.
2. **Exams and marks.** The biggest missing module for schools: subjects
   already exist, so this is assessments, marks per student per subject, and
   report cards.
3. **Online payment.** Fees, charges and receipts are recorded by the office;
   a parent reads them and cannot pay through the portal. A gateway is the next
   step, and `FeePayment` is the row it would write.
4. **Payments.** Plan billing for the platform itself. `Subscription` already
   records entitlement; this adds the gateway and the renewal lifecycle.
5. **File uploads.** Photos and documents are `https://` links today. Object
   storage plus signed URLs would let schools upload directly.
6. **Subdomains and custom domains.** The schema and `proxy.ts` were built for
   this: `School.subdomain` and `customDomain` exist and are unique. Host-based
   routing rewrites onto `/schools/[slug]`, so it is one file, not a rewrite.
7. **SMS.** Absence alerts to parents are the obvious first use.
8. **Homework and lesson records for students and parents.** A teacher sets
   homework and it is stored `PUBLISHED`, but no student or guardian screen
   reads it yet, and neither does the API. The queries are written
   (`homeworkDueForMySections` is the shape a section-scoped list needs); this
   is a portal page and a `/api/v1/homework` route away from being end-to-end.
9. **Period-level attendance.** `ClassSession` now records what happened in a
   period — substitute, remote, missed — but not who was in the room for it.
   Per-period presence is the remaining half, and needs no backfilling.

Housekeeping worth doing early: put the repository back under version control
(the `.git` directory was lost), and rotate any credential that has been pasted
into a chat or a screenshot.

---

## 9. Operational notes

- **Seeding.** `db:seed` **wipes the database** and is for a throwaway local
  one only. `db:seed:demo` is the safe one: it adds a Super Admin and two
  fully set-up demo schools (`demo-*` slugs), touches nothing else, replaces
  its own data when re-run, and writes the logins into `.env` as comments.
- **Migrations** are forward-only in production: `db:deploy`, never
  `migrate dev` or `reset`. Review the SQL for data backfills — the email
  verification migration contains one.
- **Secrets** live in `.env` (gitignored) and in the host's environment in
  production: `DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`,
  `APP_URL`.
- **One-time passwords** — for a new school admin, a teacher, a student or a
  guardian — are shown once and stored only as bcrypt hashes. Lost means
  reissued, never recovered.
- **API tokens** act as the person who created them, can be read-only, and die
  with that person's account.
- **People are deactivated, not deleted.** Setting a teacher to Inactive keeps
  their registers, lessons and homework and closes their sign-in. Delete exists
  only for a record added by mistake: it is refused the moment there is history
  to lose, and it names what is in the way.
- **The audit log** is append-only and is where to look first when someone
  asks "who changed this?". It never records credentials.
- If the app cannot reach the database, check DNS before blaming the code: a
  home ISP resolver refusing a hosted database's hostname looks exactly like an
  outage.
