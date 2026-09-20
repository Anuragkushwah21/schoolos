# SchoolOS

Multi-tenant school management SaaS. One Next.js application and one PostgreSQL
database serve every school; adding a school is a database row, not a new
deployment.

**What it does.** A school registers from the marketing site and verifies its
contact address with a six-digit code; a Super Admin then approves it, which
provisions its classes, streams, subjects and current session and issues the
first administrator. That administrator runs the school:
sections and staff, students and guardians, the weekly timetable, daily
attendance and reports, notices and events, online admissions, and the school's
own public website. Teachers mark their own classes, students see their
timetable and attendance, and guardians see their own children.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the tenancy model,
authorization design and directory layout, and [`docs/API.md`](docs/API.md)
for the REST API.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui ·
Prisma 7 · PostgreSQL · Zod · Vitest

## Local setup

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL and SESSION_SECRET
npm run db:migrate
npm run db:seed
npm run dev
```

`SESSION_SECRET` must be at least 32 characters — generate one with
`openssl rand -base64 48`.

### Which database am I on?

`.env` holds one live `DATABASE_URL` and the other commented out — a local
cluster for throwaway work, or a hosted one (Neon) with real data. Check before
you run anything destructive:

```bash
grep '^DATABASE_URL' .env
```

**On a real database, use `db:deploy` and nothing else.** `db:seed` wipes every
table before writing and now refuses any host that is not local; `db:reset`
drops the whole schema and is for the local cluster only.

```bash
npm run db:deploy   # apply migrations — safe on real data
```

A fresh database has no accounts, and nothing can happen without a Super Admin,
so create one by hand once:

```bash
npx tsx scripts/create-super-admin.ts you@example.com "Asha" "Verma"
```

The password is printed once. Sign in at `/login`, change it under Account,
then approve schools from **Platform → Schools**.

### Local database

A dedicated PostgreSQL 16 cluster lives outside the repo at
`~/.local/share/schoolos-pg` and listens on **port 5433**, so it cannot collide
with any other Postgres on the machine.

```bash
npm run db:start    # start the cluster
npm run db:stop     # stop it
```

Requires `pg_ctl` on `PATH`:
`export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"`.

Tests always use `.env.test`, which points at the local `schoolos_test`
database, and the test bootstrap refuses to run against anything else — so
`npm test` can never touch real data.

## Email

Outbound mail — the sign-up code, and a new school's sign-in details — goes
through [Resend](https://resend.com). Two variables:

```bash
RESEND_API_KEY="re_…"
MAIL_FROM="SchoolOS <onboarding@resend.dev>"
```

**Until you verify a domain, Resend only delivers to the address that owns the
account.** Registrations from anyone else generate a code that never arrives:
the failure is logged, the audit entry says the email could not be delivered,
and asking for another code tells the person so. To fix it, verify a domain at
[resend.com/domains](https://resend.com/domains) and set `MAIL_FROM` to an
address on it.

Without `RESEND_API_KEY`, messages are written to the server log instead,
clearly marked, so the whole flow still works in development:

```
[mail] NOT DELIVERED — no provider configured
Subject: 369558 is your SchoolOS verification code
```

Swapping in a different provider is one call to `setMailTransport` in
`src/server/mail/mailer.ts`.

## Development accounts

`npm run db:seed` (local databases only) creates two fully-populated schools
plus a pending registration. Every account uses the password `Password123!` — development
only, and the seed refuses to run against production.

| Role | Email |
| --- | --- |
| Super Admin | `superadmin@schoolos.test` |
| School Admin (ABC Public School) | `admin@abc-public-school.test` |
| School Admin (XYZ High School) | `admin@xyz-high-school.test` |

Signing in as each school admin shows the isolation working: the two
dashboards report different students, teachers and classes from the same code.

Seeded teacher, student and parent accounts follow the pattern
`first.last.<school-slug>@schoolos.test` — for example
`rahul.sharma.abc-public-school@schoolos.test` (teacher) and
`sanjay.kulkarni.abc-public-school@schoolos.test` (parent). Each school's public
website is at `/schools/<slug>`, e.g. `/schools/abc-public-school`.

## Dashboards

Each role has its own dashboard: attendance trends, today's register, class
strength and an admissions funnel for the School Admin; the platform's growth,
status mix and largest schools for the Super Admin; their own classes and the
students who need attention for a teacher; their own record for a student; and
each child's attendance for a guardian.

The charts are server-rendered SVG with no charting dependency, and every one
carries a table view of the same numbers.

## API

`/api/v1` covers everything the screens do — students, staff, academics,
timetable, attendance, reports, notices, admissions, the school website and
platform governance — plus public endpoints for a school's site and for
registration. `GET /api/v1` lists the surface.

Calls authenticate with the session cookie, or with a bearer token created
under **API tokens** in the sidebar. A token acts as the person who created it,
can be read-only, and stops working the moment their account is disabled.

```bash
curl http://localhost:3000/api/v1/me -H "Authorization: Bearer sos_…"
```

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Database

```bash
npm run db:migrate    # create and apply a migration in development
npm run db:deploy     # apply migrations in production
npm run db:seed       # development seed data (fake schools, staff, students)
npm run db:studio     # browse data
npm run db:reset      # drop, re-migrate and re-seed
```
