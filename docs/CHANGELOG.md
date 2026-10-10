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

_Last updated: 10 Oct 2026 (Plan Builder templates: auto-selected modules and features)_

| | |
| --- | --- |
| Database migrations | 59 in `prisma/migrations`. Neon (read-only check 10 Oct): applied through `20261102090000_ptm_responses`; **NOT applied: `20261103090000_plan_template`** — run `npx prisma migrate deploy` (adds one nullable column + backfill; the Plan Builder needs it). |
| Tests | 113 files, 1113 tests passing (10 Oct); typecheck clean; lint 0 errors (8 pre-existing warnings); production build passing. |
| Email | Code sends through Gmail SMTP when configured. **The Gmail App Password in `.env` was rejected by Gmail** — create a new App Password and put it in `SMTP_PASSWORD`. Demo sandboxes never send email. |
| Uncommitted work | Everything since commit `9cdbfdf` |

**Setup gaps on the live database** (not code bugs — features look broken until these are filled in):

- **Sankeswar** — all 7 sections have **no class teacher**; **0 subjects** assigned to teachers; no students yet. Without these, attendance registers have no owner, leave requests only the admin can approve, and every concern goes to the School Admin.
- **Green Valley Academy** — 9 of 13 sections have no class teacher.

**Known limits:** no online payment gateway (payments are recorded at the fee desk); no SMS/WhatsApp; the Live Demo rate limit is in memory per server instance (6 starts per IP per hour), so several instances each allow 6; expired demo sandboxes are deleted when the next demo starts, not on a schedule.

---

## 10 Oct 2026 — Plan Builder templates: auto-selected modules and features

**Asked:** when a Super Admin creates or edits a plan, pre-select modules and features from Starter / Growth / Pro templates or from the saved configuration; Included / Not included, counts, a Customized indicator, Load template, Restore defaults, Select all, Clear optional, module details, dependency checks, a diff against the published plan and an impact preview. A saved plan is never reset when it is opened, and entitlement stays separate from campus activation.

**What already existed (reused, not rebuilt):** Plan Builder with draft → publish, ladder rules, essential modules (Fees & finance, Expenses), impact preview with grandfathered campuses, organization-wide plan changes, campus modules that never switch on with a plan, Super Admin–only server checks, audit on every plan change.

**Changed**
- `Plan.templateKey` (starter / growth / pro / null): which template a plan is compared against. It is a label for the editor, not an entitlement.
- `src/lib/plan-catalog.ts`: `PLAN_TEMPLATES` (Starter: 1 campus, essentials, no org features, basic office roles; Growth: 2 campuses, + Payroll and Library, Organization dashboard, + Librarian; Pro: 3 campuses, all six modules, both features, all roles). Also `templateSelection`, `templateDiff`, `planWarnings` (a role whose module is missing, e.g. Librarian without Library — this is advice and does not block publishing) and `MODULE_CAPABILITIES` (read-only "What's inside"). `DEFAULT_PLANS` is now derived from the templates.
- `createPlan`: "Start from" a template (default Growth) or a copy of the highest plan. The audit says which template.
- `savePlanDraft`: stores the template label, audits "customized from X" or "matches the X template", and returns warnings.
- `listPlans`: per plan, the template diff, warnings, and "changes from the published plan".
- Plan Builder form (`src/features/platform/plan-builder.tsx`):
  - opens on the saved draft or live configuration;
  - Load template and Restore defaults change the form only after a confirmation, and nothing is saved until "Save draft";
  - Select all modules / Clear optional modules (essentials stay);
  - Included / Not included on each module and feature, live counts, the Customized / Matches template badge with what differs;
  - expandable module details, live role warnings, and roles that are now controlled.
- Plans page: template badge, "Changes from the published plan" and "Check before publishing". The existing impact preview is unchanged.
- Hindi for every new string.

**Migration:** `20261103090000_plan_template` (one nullable column, backfilled from tier: STARTER→starter, STANDARD→growth, PRO→pro). Applied to the local test DB only. **NOT applied to Neon.** Neon was checked read-only first: all 58 earlier migrations are on it.

**Tested**
- Unit (`tests/unit/plan-catalog.test.ts`): templates climb the ladder and pass `planProblems`; selections are copies; default plans equal the templates; `templateDiff`; warnings that do not block.
- Integration (`tests/integration/plan-builder.test.ts`):
  - create from a template, or without one;
  - an invalid template and a non–Super Admin are refused;
  - reopening keeps the saved selections and shows Customized;
  - restore happens only by saving;
  - a draft of a plan in use changes no entitlements and no campus modules, and lists its changes;
  - `listPlans` is Super Admin only.
- Full suite: 113 files, 1113 tests pass. Typecheck clean, lint 0 errors, `next build` passes.
- Browser check (production build on the test DB): Load template → confirmation → counts and hidden template updated → Select all → What's inside; no page errors.

**Open / decisions**
- Admissions, PTM, attendance and the other core modules are always on, so templates vary only the six optional modules, the two organization features, roles and campuses. Gating core modules by plan would take access away from existing Starter schools — that needs your decision.
- Parts inside a module (e.g. late fees within Fees & finance) have no separate entitlement; "What's inside" is read-only.
- Saving a draft updates the template label at once (it is not an entitlement). The selections themselves reach schools only when the plan is published.

---

## 10 Oct 2026 — Unified, audience-aware calendar and weekly reminder

**Asked:** whenever a dated school activity is created for an audience, it should appear on those people's calendars automatically (no second entry), with a month view, upcoming list, details, dashboard reminders, correct handling of edits/cancellations/drafts, and strict server-side visibility.

**Existing architecture (kept):**
- A read layer (`server/calendar/entries.ts`) already combined events, exams, meetings and approved leave per role, with holidays drawn on the month grid.
- Meetings already carried audience targeting: role groups × whole school / sections / chosen students and staff (`visibleMeetingWhere`).
- Each role has a Calendar page (`/…/holidays`).

**Gaps found:**
- Items were titles only: no time, venue, link, instructions or details view.
- Cancelled meetings simply vanished.
- Class tests were missing.
- No upcoming list or dashboard reminder.
- Leaders' links and the holiday editor shared one click.

**Changed:**
- **One read layer, no copies.** Calendar items are read from their own records:
  - holidays, events, meetings/PTMs, exams, class tests, approved leave;
  - editing, rescheduling or cancelling the record is what changes every calendar;
  - each item carries time, venue, optional online link, instructions, a detail line (e.g. "Parent-teacher meeting · Parents + Teachers · Class 8 – A") and a link to open it for that role;
  - one entry per source record (keyed), so nothing appears twice; exams created per section show once.
  - No new table, so no migration.
- **Visibility, all on the server from the session:**
  - meetings only for the groups and classes/students chosen;
  - events published only (drafts marked for the office);
  - exams by section;
  - class tests by section and stream (a test for one stream reaches only that stream's students and parents);
  - parents through their linked children's current placements;
  - other schools never.
  - Notices stay in Notices — they have no meaningful activity date.
- **Calendar page (every role):**
  - month grid with Previous / Next / Today;
  - tap a day to see its items in full — category, time, venue, "Join online", instructions, "Open";
  - "Coming up — next 30 days";
  - holidays below.
  - Cancelled meetings stay on their day, struck through and marked "Cancelled", with no join link.
  - The School Admin adds or edits a holiday from the selected day.
- **Reminder:** every dashboard's "School updates" card starts with "Coming up this week" (next 7 days, "Today" / "Tomorrow" with time, link to the calendar). It leaves out cancelled items, drafts, and meetings that already ended earlier today, using the school's time zone.
- No push, email, SMS or WhatsApp is claimed or added; reminders are in-app on the dashboard. Scheduled reminder timing is not part of this (no scheduler exists).

**Tested:**
- New `tests/integration/calendar.test.ts` (8):
  - a class meeting reaches its teachers, students and parents and not a parent of another section, a teacher without the class, staff, or another school;
  - parents-only meetings;
  - chosen-student meetings;
  - class tests by section and stream;
  - draft events office-only until published; holidays for all;
  - cancelled shown as cancelled and out of "upcoming"; rescheduling shows only the new date;
  - no duplicates and full details;
  - school-date boundary (a meeting that ended earlier today leaves "upcoming", a later one stays).
- Full suite 1105/1105 (existing notices, PTM, exams and holiday tests included), typecheck, lint (0 errors), `next build`.
- Browser (production build, test database, demo school): parent calendar with the day's PTM details and the 30-day list; parent mobile dashboard showing "Coming up this week".

**Limitations:**
- Events have no audience of their own (whole school, as before).
- Reminders have no configurable timing and no read/unread state of their own (meetings and notices keep theirs in the alert feed).
- The calendar URL stays `/…/holidays`, titled Calendar.

## 10 Oct 2026 — Meeting link clearly optional

**Asked:** when creating a PTM or any meeting, make the link field optional.

**Found:** the link was already optional on the server (`optionalUrl`) and not required in the form. It still felt mandatory because:
- the label did not say "optional";
- the field was `type="url"`, so the browser refused a link typed without `https://` (e.g. `meet.google.com/abc`);
- the server then asked for "an https:// link".

**Changed:**
- **Label:** "Online meeting link (optional)", with the hint "Leave empty for a meeting at school". Location is labelled optional too.
- **Browser check removed:** the field is plain text with `inputMode="url"`, so the browser never blocks the form.
- **`https://` added automatically:** a link typed without it gets it (`meet.google.com/abc` → `https://meet.google.com/abc`).
- **Still refused:** an empty link is saved as no link; `http://` and broken addresses are still refused with a clear message.

**Migration:** none.

**Tested:**
- New `tests/unit/meeting-link.test.ts` (3): empty or left out, `https://` added, http/broken refused.
- Unit tests plus the meetings, PTM and principal integration tests: 17 files, 130 tests passing.
- Typecheck, lint, `next build`.

## 10 Oct 2026 — Simple PTM: parent answers, class lists, attendance and remarks

**Asked:** finish a simple PTM workflow:
- announce;
- optional parent answer (Will attend / Unable to attend / Not responded, no slots);
- the teacher's class-wise list;
- recording what actually happened (Attended / Did not attend / Rescheduled) with private remarks and follow-up;
- reliability, privacy and tests.

**Already existed (reused):**
- PTMs as Meetings of type PTM: title, date, start/end time, location, instructions, audiences, and targeting by whole school, sections or chosen students.
- Create, edit, cancel, reschedule and delete by the School Admin / Principal / staff with "schedule meetings".
- Server-side visibility per role (`visibleMeetingWhere`).
- Meetings pages for parents, students and teachers, and dashboard alerts.

**Added:**
- **`PtmFamily`** — one row per PTM and child (unique): the parent's answer (with who and when), and separately the recorded attendance, remarks, follow-up, and who recorded it.
- **Parents** see "Will you come? (optional)" on each PTM, one line per child it is for, with "Will attend" / "Unable to attend" and "Not responded" until they answer. They can change it until the PTM ends. Only a linked parent, only for a child the PTM targets; another family's or school's child, a PTM for another class, an ended or cancelled PTM are refused.
- **Teachers** get "Class list and attendance" on each PTM (`/teacher/meetings/[id]`):
  - summary (will attend, unable, not responded, attended);
  - class-wise families with parent names and answers, limited to the classes they teach or are class teacher of.
- **Recording what happened:**
  - only the class teacher of the child's section, or the School Admin / Principal (who also see the Families panel on the meeting page);
  - only once the PTM has started, never for a cancelled one;
  - recording again corrects it.
- **Answer and attendance are separate:** a "Will attend" can be recorded as "Did not attend".
- **Remarks and follow-up are staff-only.** They are never returned to parents or students, and the audit says "notes recorded" without the text.
- **Moving a PTM to another date or time** clears earlier answers, so families answer for the new time. Other edits keep them.
- Audit: `PTM_RESPONSE_SAVED`, `PTM_ATTENDANCE_RECORDED` (with the change, e.g. "Did not attend → Rescheduled").
- Mobile-friendly: large buttons, cards instead of wide tables.
- Hindi for every new string.
- No SMS, WhatsApp, slots or payments.

**Migration:** `20261102090000_ptm_responses` — enums `PtmResponse`, `PtmAttendance` and table `PtmFamily` (additive; tenant-scoped through `TENANT_MODELS`). Applied to the local test database only — **NOT on Neon**.

**Tested:**
- New `tests/integration/ptm.test.ts` (7):
  - answers saved and changed with exactly one row;
  - only linked parents, for targeted children, before the end; teachers cannot answer;
  - the class teacher's list with counts;
  - no recording before the start;
  - after the PTM, attendance separate from the answer; private notes never reach the family or the audit text;
  - parents and students refused the staff list;
  - a teacher without the class and another school's admin get "not found";
  - cancelled PTMs refuse both;
  - rescheduling clears answers, other edits keep them.
- Full suite 1094/1094, typecheck, lint (0 errors), `next build`.
- Browser on a production build (demo school): parent "Will attend" → saved message → stays after reload; teacher's class list shows the answer.

**Note:** during the browser check the server was first started without the test environment and briefly pointed at the live Neon database. It read nothing but a session lookup (the test session did not exist, so it showed the login page) and wrote nothing. It was stopped at once and restarted on the test database.

**Open:**
- a family's own view of whether they were marked as attended is not shown (not asked for);
- teachers still cannot create PTMs themselves (unchanged permission).

## 10 Oct 2026 — Super Admin control center: organizations and plan changes

**Asked:** audit how the Super Admin manages organizations, campuses, plans, subscriptions and features; give one clear management model; make the plan change from an organization page clear, safe and auditable; keep it simple for non-technical users.

**Audit:**
- **Screens before:**
  - Dashboard, Schools (list + a long school page), Approvals, Campus requests, Plan requests, Feature requests, Plans (builder), Reports, Audit, Settings, Website enquiries, Offers.
  - There was **no organization page**: a customer's plan, campuses and limits were spread over cards on each school's page.
- **Where a plan can change:**
  - school approval (choose plan);
  - the school page's Subscription form (organization-wide since the previous fix);
  - plan request approval;
  - the Live Demo switcher (demo only).
  - Plans are defined only in the Plan Builder.
- **Where modules change:**
  - the School Admin's Plan & billing (eligible modules only);
  - the Super Admin's per-campus module card (any module — an exception tool);
  - the Plan Builder (eligibility only);
  - the demo (sandbox only).
- **Conflicting control:** the Super Admin card's "Follow the plan" switched on *every* plan module, which read like an automatic rule.
- **Source of truth:**

| What | Where |
|---|---|
| Plan definition | `Plan` (published columns) |
| Active plan | `Subscription` on each campus, kept in step by `setSubscription` |
| Switched-on modules | `School.optionalModules` |
| Campus cap | `Organization.campusLimitOverride` over the plan |
| Permissions | `lib/permissions` + staff grants |

- **Plan-change inconsistency:** the single-campus subscription change (fixed in the previous entry) plus **legacy data**: organizations whose campuses were already on different plans were not visible anywhere. Downgrading below the number of campuses gave no warning.

**Changed:**
- **Sidebar in five groups:**
  - Overview: Dashboard, Platform reports
  - Schools & Organizations: Organizations (new), Schools, Approvals, Campus requests
  - Plans & Features: Plans & Features, Feature requests
  - Subscriptions & Requests: Plan requests, Offers, Website enquiries
  - Platform Settings: Platform settings, Audit logs
  - Nothing was removed.
- **Organizations list** (`/super-admin/organizations`): search, campuses, plan, and a "Campuses on different plans" flag.
- **Organization page** (`/super-admin/organizations/[id]`):
  - current plan, status, dates and price;
  - campus allowance with the campus limit;
  - what the plan includes;
  - every campus with its plan ("Different plan" flagged), modules on, in plan but off, kept;
  - history (plan, subscription and module audit entries).
- **Change plan on that page:**
  - pick a plan and see a side-by-side comparison (price, campuses, student/teacher limits, newly included modules, no longer included and where kept on, features gained/lost);
  - a required "I have checked the comparison" tick, and a second tick when the organization runs more campuses than the new plan allows (existing campuses stay, no more can be added);
  - saving goes through `setSubscription` (every campus, one transaction), which also fixes legacy mixed plans;
  - re-sending the same plan changes nothing and writes no history (double submit safe);
  - drafts are never offered.
- **School page:**
  - links to the organization page from "Owner & campuses" and from the subscription card;
  - the module card is now "Campus modules (Super Admin)", explaining that the owner normally switches modules on, and the checkbox reads "Switch on everything in the X plan".
- New server module `src/server/platform/organizations.ts` (reads and changes through existing services — no second source of truth).
- Hindi for every new string (70) and the nav groups.

**Migration:** none.

**Tested:**
- New `tests/integration/organization-plan.test.ts` (6 tests):
  - listing and the mixed-plan flag;
  - comparison (new, removed, kept-on, features, over-cap, drafts excluded);
  - over-cap refusal without confirmation;
  - saving moves all campuses and fixes mixed plans, keeps modules;
  - double submit changes nothing and adds no history;
  - the School Admin's Plan & billing and "available to switch on" follow;
  - non-Super Admin, draft plan and unknown organization refused; another school untouched;
  - sidebar groups.
- Full suite 1087/1087, typecheck, lint (0 errors), `next build`.
- Browser on a production build:
  - organizations list with the mixed flag;
  - organization page;
  - choose Pro → comparison shown;
  - without the over-cap tick the browser refuses to submit;
  - with both ticks → "Plan saved for all 2 campuses", mixed warning gone, history shows the change.

**Open:** a School Admin's already-open tab shows the change on their next click.

## 10 Oct 2026 — Fix: Super Admin plan change not reaching the School Admin

**Asked:** after the Super Admin changed a school's plan, the School Admin's dashboard did not show it.

**Root cause (reproduced with a failing test first):**
1. **Only one campus changed.** The Super Admin's subscription form changed only the school whose page was open. The organization's plan — which the owner's dashboard, My Schools, Plan & billing and module eligibility read — is the plan of its first campus. Changing any other campus showed nothing to the owner, and left the campuses on different plans.
2. **Stale pages.** The save revalidated only `/super-admin/dashboard`, so even the Super Admin's own school page kept showing the old plan until reloaded.
3. **Nothing visible changed.** By design a new plan only makes modules *eligible* and switches none on, but no screen said so: the sidebar and dashboard looked exactly the same.
4. **Inconsistent approval on failure.** An approved plan request was marked approved before the plan change ran; if the change failed, the request stayed "approved" with the old plan in place.

**Changed:**
- `setSubscription` applies the plan, status and dates to every campus of the school's organization (pending, under review, active or suspended) in one transaction — all campuses or none. A school without an organization changes alone. Campus modules are never switched on; roles the plan adds are offered additively, as before. Plan requests use the same path.
- If the change fails, the plan request goes back to waiting.
- Saving a subscription or deciding a plan request revalidates every signed-in area. The message says how many campuses were changed and that modules are unchanged.
- The Super Admin's subscription card says when the change will apply to several campuses.
- School Admin:
  - **dashboard notice**: "Your Pro plan includes Payroll, Library… not switched on for this campus yet", with a link;
  - **badge on My Schools** with the count;
  - **Plan & billing** shows each module as on, "Included in your plan — off for this campus", kept (grandfathered), or "Not in your plan — comes with …".
- Module pages already explain "not switched on here" versus "not in your plan" (`ModuleGate`). Server checks are unchanged: an eligible-but-off module stays closed.

**Migration:** none.

**Tested:**
- New `tests/integration/plan-change-sync.test.ts` (6): a change from any campus's page moves the whole organization and the owner's views read it; new modules eligible but none switched on, selections kept; downgrade keeps a grandfathered module; non-Super Admin refused, invalid plan or dates leave every campus unchanged, another school untouched; nav badge and dashboard count, with eligible-but-off modules still refused on the server; plan request approval moves every campus, and a failed approval leaves the request pending and the plan unchanged.
- Full suite 1081/1081 (one unrelated intermittent failure on an earlier run, see Current status). Typecheck, lint (0 errors), `next build`.
- Browser check (production build, demo sandbox on Pro with two modules on): dashboard notice and Plan & billing states.

**Open:** a School Admin who already has a page open sees the change on their next navigation (pages are rendered per request; there is no push to an open tab).

## 9 Oct 2026 — Core workflow audit: integrity, permission and student-support fixes

**Asked:** audit the core school workflows end to end (students and admissions, attendance, fees, exams, timetable and homework, dashboards, student support, communication, staff roles, setup) and implement the most important verified gaps.

**Audit (read-only, three passes with file-level evidence):** most workflows were already complete and correct, among them:
- transaction-safe admission numbers, duplicate-student warnings, cross-school parent links blocked by the database;
- section capacity under lock, attendance unique per student per day with consistent corrections;
- receipt numbers unique, double-submit protection, submit → verify → publish with guarded steps;
- report cards to the student or a linked parent only;
- no student path to fee data (checked every page, API route, alert feed, search and receipt);
- notice targeting by class, section, stream or student with server-side filtering, emergency notices, holidays, PTMs;
- support records with follow-up statuses.

**Fixed — security / permissions:**
- The Principal could turn an enquiry's agreed discount into a real fee concession (`applyDiscussedConcessions` checked only "students: edit") and enter fee figures on a new enquiry. Both now need the fee permissions (School Admin, or staff with `fees.concessions` / `enquiries.fees`); the "Apply agreed discount" page is School Admin only.
- Exam papers for one stream could be marked by a teacher of the same subject in another stream; now checked with the stream.

**Fixed — data integrity:**
- Re-raising a fee head with fewer instalments silently deleted concessions on the dropped instalments (cascade). Now refused while a dropped instalment has a concession. (Payments are account-level, so money was never lost.)
- Charging a whole section again overwrote children's individually corrected amounts. Children who already have that head are now left unchanged and the result says how many.
- A student who left could be set active again without a seat check, overfilling a section. Now takes a seat under the same lock as admission; a full section refuses.
- The last guardian of a student could be removed; now refused. Removing the primary guardian passes "primary" to the next one, and the removal is audited (`PARENT_UNLINKED`).
- Teacher timetable clashes are re-checked inside the write under a lock (partly overlapping periods saved at the same moment could both get in).
- Students on long leave (status ON_LEAVE) disappeared from the attendance register; they now appear, marked "on long leave".

**Improved:**
- **Needs attention:** attendance and homework signals beside marks — attendance below the school's threshold (default 75%) over its window (default 30 days; approved leave not counted, at least 5 marked days), and a teacher's remark that homework is frequently missing. Every row says what was seen. Class-wise summary (marks / attendance / homework flags, support open / resolved) for the School Admin, Principal and each teacher's own classes. The threshold and window are School Admin settings. The Principal and teacher dashboards use the same threshold instead of a hardcoded 75%.
- **Daily collection** on Fee reports: today's total, receipts, voided payments, by method and by who took it.
- **Parents** can open homework and class notes files for their own children's current sections (server-checked); homework resources are listed on the parent's homework page. The Principal can open files too.
- **Admin dashboard:** students by class with boys and girls (Nursery–Class 12). Class strength now counts students on leave and lists empty classes.
- **Student search** matches each word, so a full name ("Ravi Kumar") or "name + phone" works. The CSV download keeps the gender and admission-year filters.
- The Principal dashboard says "Needing attention", not "Weak students".

**Not changed, deliberately:**
- Accountant default grants (full accounts, an earlier decision of 7 Oct).
- Receptionist defaults.
- Teachers cannot post notices (permission VIEW).

**Migration:** `20261101090000_attention_signals` — `School.attendanceAttentionPercent` (default 75) and `attendanceAttentionDays` (default 30). Additive. Applied to the local test database only — **NOT on Neon**.

**Tested:**
- New `tests/integration/core-integrity.test.ts` (9 tests): concession guard, section re-charge, ON_LEAVE on the register, return into a full section, last guardian, full-name search and CSV gender filter, class strength, attendance/homework signals with scope, daily collection.
- `family-enquiries` adds the Principal refusal.
- `class-materials` and `homework-resources` now expect a linked parent to get the file and another school's parent to get "not found". These two tests previously asserted that parents are always refused; this reverses that, per this request.
- Full suite before the material change: 1073/1075, with the 2 failures being exactly those two tests.
- Final run: 108 files, 1075/1075 passing; typecheck clean; lint 0 errors; `next build` passing.

**Still open (not implemented):**
- refunds (only void exists; needs a refund policy);
- PTM time-slot booking;
- event audience targeting;
- teachers posting class notices;
- per-notice read counts;
- a school-wide attendance CSV;
- keeping section-change history within a session (only the audit log has it);
- application-number generation can fail under heavy simultaneous load (unique constraint prevents duplicates).

## 9 Oct 2026 — Fix: requests hanging ~76 s, then database ETIMEDOUT

**Asked:** the dev server (on Neon) showed `/api/v1/me/alerts` returning 500 after 76 s with `PrismaClientKnownRequestError ETIMEDOUT` in `validateSessionToken`, and "The destination stream closed early".

**Cause:** the connection pool had no connect timeout and no idle timeout. Neon closes idle connections (and suspends idle computes); the pool then tried to use or open a connection that never answered, and waited for the operating system's TCP timeout (~75 s on macOS) before failing. The browser gave up meanwhile, hence "stream closed early". Neon itself was reachable when checked (`SELECT 1` in under a second, read-only).

**Changed:** `src/server/db/connection.ts` — pool timing for hosted Postgres: connect timeout 10 s (a clear error instead of a 76 s hang), idle connections closed after 20 s (before Neon drops them), TCP keep-alive on. Applies to the app and the scripts that share `connectionConfig`.

**Migration:** none. Neon migration status checked read-only: up to date.

**Tested:** typecheck; `live-demo`, `plan-builder`, `campuses` integration tests (37) against the local test database; read-only connection check to Neon.

**Open:** restart the dev server so the new pool settings are used (the cached pool lives until then).

## 9 Oct 2026 — Dynamic plans: Plan Builder, plan comparison, demo plan switcher, custom feature requests

**Asked:** database-driven Starter / Growth / Pro plans configured by the Super Admin (draft → preview → impact → publish), one subscription per organization with campus-level modules, configurable extra-campus pricing, a public plan comparison at registration, a plan switcher in the Live Demo, a custom feature request workflow, and server-side entitlement checks.

**Reused, not rebuilt:** `Plan`, `Subscription` (one row per campus, kept on the same plan for the whole organization), `Organization.campusLimitOverride`, `School.optionalModules` (what a campus has switched on), plan requests, campus requests, school approval, the Live Demo sandboxes.

**Changed — reverses earlier behaviour (deliberately, per this spec):**
- Editing a plan no longer pushes its modules to "follower" schools, and a plan change (approval of an upgrade, or the Super Admin setting a subscription) no longer switches modules. A plan makes modules *eligible*; the owner (any campus) or a School Admin (their campus) switches them on at **Plan & billing → Modules by campus**. A module a plan stops including stays on (grandfathered) until switched off. Roles a plan adds are still offered to campuses that follow the plan's roles (additive only).
- Approving a plan request moves **every campus** of the organization to the plan (before: only the requesting school).
- The All Campuses summary needs the plan feature **Organization dashboard** (or a Super Admin campus-limit override above 1).

**Plan Builder** (Super Admin → Plans): create plans (draft), edit name, description, highlights, display order, price / billing period / "price on request", included campuses, extra campuses (allowed, price, period, cap), the full module catalogue (essential modules locked on), organization features, roles and limits. Edits save as a draft; the page shows rule problems, an impact preview (organizations and campuses on the plan, grandfathered modules, campuses over the new cap, price-change note), a preview card and comparison, then **Publish** (confirmed), **Discard draft**, **Open / Close to new schools**, **Archive / Restore**. Rules: every plan keeps Fees & finance and Expenses; plans are a ladder by display order (each keeps everything below it, modules and features); module dependencies are checked (none exist between today's modules, the check is in place). Every step is audited (`PLAN_CREATED`, `PLAN_DRAFT_SAVED`, `PLAN_PUBLISHED` with a diff and impact, …). Discounts stay with the existing Offers.

**Public side:** homepage pricing, `/register` and `/demo` read the same published plans (`getPublicPlans`: published + open only, display order). `/register` shows plan cards, "Compare all features" (module-by-module, grouped), the extra-campus policy, and the form on the same page; choosing a plan never clears what was typed and is kept in `?plan=`. Registration accepts a published plan slug (old `?plan=STARTER` links still work), refuses closed/unknown plans, and records it as a TRIALING subscription as before. "Price on request" never shows a number.

**Campuses & billing:** a campus request past the included campuses is quoted the plan's extra-campus price (stored on the request; shown to the owner before sending and to the Super Admin when reviewing); past the cap it needs an upgrade or the Super Admin's raise. Plan & billing shows the full breakdown (plan fee once + extra campuses) before any plan request; every confirmation says nothing is charged — there is no payment gateway.

**Live Demo:** `/demo` has a plan chooser (default: the highest plan) and the comparison; the demo bar has a **Plan** switcher. Switching sets the sandbox's subscription and modules to exactly that plan (server-side, demo schools only); menus and module pages follow, and a module outside the plan explains which plans include it. Multi-campus features are described, not interactive (one campus).

**Custom feature requests:** owners on a plan with the feature (default Pro) submit requests (title, problem, description, outcome, campus, module, priority, examples) and follow history; the Super Admin moves them through Submitted → Needs clarification → Under evaluation → Approved → In development → Testing → Released / Declined, with estimate, agreed cost (required before development), developer/tester, internal notes, and an explicit release scope (customer-specific / optional module / standard feature / paid add-on) with eligible plans or organizations. A release never changes plans by itself. Attachments are not supported (text examples only).

**Entitlement service** (`server/platform/entitlements.ts`): `organizationEntitlements` (plan, eligible modules, features, included campuses, cap, extras), `assertPlanFeature`, `moduleStatus` (enabled / not switched on / not in plan); `server/campuses/modules.ts` for campus module switching. Existing `assertModuleEnabled`, role and tenant checks are unchanged.

**Migration:** `20261031090000_plan_builder` — additive: Plan gets `slug` (backfilled from tier), `status`, `displayOrder` (1/2/3), `highlights`, `billingPeriod`, `priceOnRequest`, `features`, extra-campus fields, `draft*`, `publishedAt`; `tier` becomes optional; CampusRequest gets the quoted fee; new `FeatureRequest` and `FeatureRequestEvent`. Backfill (plans only, no school or subscription touched): Fees & finance and Expenses added to every plan's eligible modules; Organization dashboard on plans with more than one campus or tier Standard/Pro; custom feature requests on Pro. Existing names and prices are kept (the Standard plan keeps its name — rename it to "Growth" in the Plan Builder if wanted). Applied to the local test database only — **NOT on Neon**.

**Tested:** new `tests/unit/plan-catalog.test.ts` (12) and `tests/integration/plan-builder.test.ts` (13); updated `school-modules`, `plan-upgrade` and `campuses` tests for the reversed behaviour. Full suite 107 files / 1066 tests passing (one earlier run under heavy machine load timed out in two unrelated tests, which passed on their own and in the clean re-run); typecheck clean; lint 0 errors; `next build` passing. Browser check on a production build: `/register` (cards, comparison, form), `/super-admin/plans` (builder, problems, preview), Plan & billing in a demo sandbox (breakdown, modules by campus, plan switcher in the demo bar), `/demo` (plan chooser and comparison). Hindi: 343 new phrases (0 missing).

**Open / decisions needed:** real prices for Starter/Growth/Pro (seed scripts create "Price on request"); whether Starter owners may send feature requests; whether to rename "Standard" to "Growth" on Neon; payment collection stays manual; attachments for feature requests.

## 9 Oct 2026 — Fix: approving a campus request at the campus limit

**Asked:** approving a campus request on Super Admin failed with "This organization is at its campus limit (1). Raise its campus limit first."

**Cause:** not a crash. The approval rightly refuses to go past the organization's campus limit, but the approve screen offered no way through: the Super Admin had to find the separate "Campus limit" form first.

**Changed:** when the organization is at its limit, the Approve form now shows a required tick box, "Raise the campus limit to N and approve". Ticking it raises that organization's own campus limit to exactly one more than its current count (its plan does not change) and creates the campus in the same transaction, with an `ORGANIZATION_CAMPUS_LIMIT_CHANGED` audit entry. Without the tick, approval is still refused, with a message that says what to do. The separate "Campus limit" form still works as before.

**Migration:** none (uses `Organization.campusLimitOverride`, already on Neon).

**Tested:** new test in `campuses.test.ts` (raise and approve: limit goes 2 → 3, campus created, audited); full suite 1041/1041, lint 0 errors, `next build`. Hindi for the 4 new messages added.

## 9 Oct 2026 — Homepage redesign, interactive Live Demo, first-campus naming

**Asked:** a new marketing homepage ("Your Entire School. One Smart Platform.") built only from real capabilities; a Live Demo that runs the real app on fictional data, with strict server-side isolation; the registered school name used as the first campus / organization name everywhere, with tests.

**Changed — Live Demo**

- Each visitor gets a **private sandbox school** ("Green Valley Demo School", `School.isDemo`, deleted after 2 hours) seeded in under a second: 36 students in Class 6/8/10 (A/B), 6 teachers, a principal, an accountant, a parent with two children (one with a student login), 30 days of attendance, homework, timetable, exams (two published, one waiting for verification), weighted final result, fees with instalments, concession, late fee and payments (3 today), notices, events, a PTM and responsibilities. All names fictional; emails on `demo.schoolos.invalid`; passwords are random hashes nobody knows.
- `/demo` page with role cards (School Admin, Principal, Teacher, Parent, Student, Accountant). The server creates the session — no credentials are shown or exist.
- Amber banner on every page: "DEMO MODE — Sample Data Only", role switch, Start over (new sandbox), Exit demo, Register your school, minutes left, and a skippable per-role tour.
- **Guards (server, by `School.isDemo` from the database, never a client flag):** no password change, API tokens, campus switch/requests or plan requests; activation, resend and password-reset emails are never sent for a demo school. Sandboxes are excluded from Super Admin lists, school detail, platform analytics, audit and public school pages.
- Receipts and report cards from a sandbox carry a red "SAMPLE" watermark and notice.
- Start limited to 6 per IP per hour; expired sandboxes are cleaned on the next start; at most 200 kept.

**Changed — homepage** (`src/features/marketing/sections.tsx`, new `role-preview.tsx`; `product-preview.tsx` removed)

- Hero with "Explore Live Demo" → `/demo` and "Register Your School"; real screenshots from the demo (`public/marketing/*.png`).
- "Does This Sound Like Your School?" (4 pain points) → problem-to-solution cards; grouped features (states that Fees & finance, expenses, payroll, library, transport and inventory are optional by plan); five-role tabbed preview with real screens; multi-campus (plan allowance, SchoolOS approval); privacy & security; getting started; live offers and pricing (now shows each plan's campus allowance instead of "all modules"); FAQ (small school, parents, multi-campus, no payment gateway, accounts, registration, demo, data); final CTA.
- "Live Demo" link in header, mobile menu and footer. No testimonials, logos, statistics or invented prices.

**Changed — first-campus naming**

- Registration already created one Organization + School with the submitted name; now covered by tests (no duplicates on repeat submission or approval).
- Super Admin can rename a school ("School / campus name" card); a School Admin's profile rename works too. A single-campus organization's name follows the school; a multi-campus group name is never overwritten. Ids never change.
- My Schools lists every campus in the organization (name, "You are here", status, city/state).

**Migration:** `20261030090000_live_demo` (`School.isDemo`, `School.demoExpiresAt`, index). Applied to the local test database only — **NOT on Neon**.

**Tested:** `live-demo.test.ts` (11) and `campus-naming.test.ts` (5) new; full suite 1040/1040; typecheck, lint (0 errors), `next build`. Browser check on a production build: homepage desktop, mobile and dark; `/demo` → Parent → switch to Principal → Exit (then `/principal` asks for login); tour close/reload/reopen; receipt and report-card watermarks. Hindi: 334 new phrases added (0 missing).

**Open:** apply the three migrations on Neon; the demo rate limit is per server instance; no scheduled sandbox cleanup (runs on each demo start); production should serve over HTTPS so the session cookie is `Secure`.

## 8 Oct 2026 — Results, fees, parent self-service and centralized records (production pass)

**Asked:** the "Production-Ready Academic Results, Fee Management, Parent Self-Service & Centralized Records" spec: audit first, then fill the gaps — no gateway, SMS or WhatsApp, and no fake features.

**Audit (before coding):**
- **Already in place, and kept:**
  - exams, marks entry with teacher-assignment checks, "publish only when every mark is in", report cards with attendance;
  - promotion with preview and undo, which keeps history;
  - fee heads, charges, concessions, payments in integer paise, soft-void receipts, family payments, carry-forward;
  - the parent dashboard (child switcher, attendance, results, homework, notices, events, meetings, fees);
  - students never see fees;
  - the parent→child link is checked on every parent read;
  - global search is tenant-scoped;
  - no privacy leak was found.
- **Gaps — results:**
  - a hard-coded CBSE grading scale and 33% pass mark;
  - no weighted final result;
  - no exempt status;
  - no review/verify step — publishing force-submitted draft marks;
  - unpublishing took no reason;
  - mark edits were audited as counts only;
  - report cards had no remarks, showed today's class teacher, and blocked the Principal;
  - families lost past sessions' results after rollover;
  - a latent path where draft marks could be returned for future-dated tests.
- **Gaps — fees:**
  - no instalments and no late fees;
  - no duplicate-submit protection and no overpayment guard;
  - the "overdue" flag looked at the earliest charge even after it was paid;
  - the void reason was always fixed ("Entered by mistake") and its audit entry had no amount;
  - a charge could be removed after payments;
  - no class-wise, session-wise, overdue or ledger reports;
  - the parent's per-child page showed gross charges against a net total;
  - a dead `showFeesToStudents` setting; the receipt print route admitted the STUDENT role (it then refused).
- **Gaps — records:**
  - no child profile for parents;
  - no fees or results on the student detail page;
  - the staff list was not paginated;
  - the students CSV ignored the list's filters;
  - opening a teacher as the Principal errored on the salary call.

**Changed — results:**
- **School grading rules:** Settings → Grading (`School.gradeBands`, `passPercent`).
  - Validated: 2–15 bands, highest first, the last band starting at 0, unique names.
  - Applied everywhere through `server/exams/grading.ts`. No stored marks are rewritten.
  - The report card's grading key comes from the school's rules.
- **Integer-safe percentages:** rounded half up to one decimal (`lib/grades.ts`).
- **Exempt** (`AssessmentResult.exempt`):
  - a Marks / Absent / Exempt picker on the marks sheet, also in the API;
  - an exempt paper is left out of the totals and of pass/fail; an absent one counts as zero;
  - counts as "entered" for completeness.
- **Lifecycle:** draft → submitted (per paper) → **verified** (`Exam.verifiedAt` / `verifiedById`, School Admin or Principal) → published (`publishedById` recorded).
  - Publish refuses any exam that is incomplete, has unsubmitted papers, or is unverified. It no longer force-submits.
  - Reopening a paper or unpublishing clears the verification.
  - Unpublish now needs a reason (also in the API).
- **Correction after publish:** `correctPublishedResult` (School Admin or Principal, reason required) changes one mark without withdrawing the exam. Audit `RESULT_CORRECTED` records the old and new value.
- **`MARKS_UPDATED`** now records per-student before/after changes in its metadata.
- **Weighted final result:** `ResultScheme`, one per session: exam names with weights that must total 100.
  - Each subject's final percentage is Σ(weight × that exam's subject %) over the components present. Absent = 0%; exempt components are left out.
  - The overall percentage uses the same weighting over each exam's overall %.
  - Pass = every subject at or above the pass %.
  - Pages: `/school-admin/exams/final` (configure, plus a per-class table). Families get a card on their results pages, shown only once every component exam is published.
- **Report card:**
  - the class teacher as at the exam date;
  - up to 3 teacher remarks;
  - "EX" for exempt;
  - the school's grading key and pass %;
  - the Principal may open it (print page and API).
- **Families keep past sessions:** published results and report cards from earlier sessions stay listed, with the session name.
- **Student draft-mark leak closed:** upcoming tests never carry marks.

**Changed — fees:**
- **Instalments** (`FeeCharge.installmentNo`; the unique key now includes it):
  - charge a class or a student "in N instalments, every M months";
  - amounts are split in whole paise that add up exactly;
  - charging again rewrites the instalments;
  - `chargeSection` runs in one transaction.
- **FIFO allocation** (`lib/fee-allocation.ts`): payments settle the earliest instalment first. Each instalment shows Paid / Part paid / Due / Overdue. The account's overdue flag and next due date are now correct.
- **Payments:**
  - an idempotency key per form (`FeePayment` / `FamilyPayment.idempotencyKey`, unique per school), so a double submit returns the first payment;
  - an overpayment guard inside a serializable transaction (one retry on a conflict) — "Add the fee to their account first" when nothing is owed;
  - the same guard for family payments, plus idempotency.
- **Voids:**
  - a reason is required (new "Void…" form);
  - the audit entry carries the receipt, amount and reason, and is not written if nothing changed;
  - a family share must be voided through the family receipt;
  - `FamilyPayment.voidedById` is recorded.
- **`removeCharge`** is refused once money has been applied to that charge (void or give a concession instead); it removes its late fee with it.
- **Late fees** (`School.lateFeeMinor`, `lateFeeGraceDays`; `server/finance/late-fees.ts`):
  - an "Apply late fees" button, never automatic;
  - one late fee per overdue instalment, enforced by the unique `(schoolId, lateFeeForId)` key, so re-applying adds nothing;
  - charged on a system "Late fee" head.
- **Reports** (`server/finance/fee-reports.ts`, `/school-admin/finance/reports`, `/staff/fees/reports`), each with CSV:
  - by class (assigned, concessions, net due, collected, pending, overdue);
  - by session;
  - overdue instalments with 0–30 / 31–60 / 61–90 / 90+ ageing;
  - a per-student ledger with running balance (`/school-admin/finance/ledger/[id]`, `/staff/fees/ledger/[id]`).
  - Every report reads each row once, so nothing is double-counted.
- **Parent fees page:** original price, concession and net amount per instalment, a status badge, a mobile-friendly layout, and a read-only **statement** page (`/parent/children/[id]/fees/ledger`).
- **Students never see fees:**
  - the receipt print route now refuses students at the guard;
  - `listStudentReceipts` drops STUDENT;
  - `showFeesToStudents` is retired (the column is kept, but nothing reads or writes it);
  - stale comments corrected.

**Changed — records:**
- **Parent → child Profile tab:** details, class, class teacher, subject teachers and guardians on file — read-only, linked children only.
- **Student detail:** published results across sessions with report-card links. For the School Admin only, the fee position with Collect and Ledger links (the Principal sees no individual fees).
- **Staff list:** server-side pagination (`listStaffPage`, 30 per page).
- **Students CSV** honours the class, section, status and search filters.
- **Teacher detail no longer errors for the Principal:** salary is loaded only for the School Admin.

**Migration:** `20261029090000_results_fees` — additive.
- New columns: `School.gradeBands/passPercent/lateFeeMinor/lateFeeGraceDays`, `Exam.publishedById/verifiedAt/verifiedById`, `AssessmentResult.exempt`, `FeeCharge.installmentNo/lateFeeForId`, `FeePayment.idempotencyKey`, `FamilyPayment.idempotencyKey/voidedById`.
- New table: `ResultScheme`.
- The FeeCharge unique key is swapped to include `installmentNo`. Existing rows become instalment 1, so the old uniqueness implies the new.
- Applied to the local test DB only. **NOT applied to Neon**, together with `20261028090000_plan_requests`.

**Behaviour changes to note:**
- Publishing now needs every paper **submitted** and the exam **verified**. Exams already published are unaffected.
- A payment larger than the outstanding amount is refused. Advance payments before a fee is charged are no longer accepted.
- Tests that relied on the old behaviour were updated (new helpers `tests/helpers/fees.ts` and `exams.ts`).

**Tested:**
- `tests/unit/results-fees-math.test.ts` (11 tests): percentages, custom bands and their validation, pass marks, exempt/absent outcomes, weighting, FIFO allocation, instalment split, month stepping, ageing.
- `tests/integration/fee-ledger.test.ts` (11 tests):
  - instalments that sum exactly;
  - FIFO statuses and a correct overdue flag;
  - a double submit is recorded once; overpayment is refused;
  - a void needs a reason and is audited with the amount;
  - a paid charge cannot be removed;
  - teachers, parents and students cannot record payments;
  - late fees are applied once and re-applying adds none;
  - class totals equal the sum of student accounts;
  - the ledger balance equals the pending amount;
  - parent-only ledger and profile;
  - students, teachers and other schools are refused.
- `tests/integration/results-lifecycle.test.ts` (6 tests):
  - a custom scale and pass %;
  - an exempt paper leaves the total;
  - unpublished results stay hidden;
  - submit → verify → publish, with teachers refused;
  - correction audit with old and new values, and families see the change;
  - final-result validation and weighted values, with families seeing it only when complete;
  - past-session results kept after rollover;
  - cross-school refused.
- Updated: exams, fee-receipts, accountant-accounts, school-tracker, staff-permissions-leave, staff-management and calendar-reports tests.
- Full suite: 103 files and 1024 tests pass. tsc and eslint are clean, and the build passes.
- Hindi: 0 missing.
- Screenshots: fee reports, ledger, exam verify, and parent fees on a phone.

**Open / not done:**
- Run `npx prisma migrate deploy` on Neon (2 migrations).
- Practical and theory as two papers of the same subject in one exam is still not possible (one paper per subject per exam).
- Promotion does not use results for eligibility — it stays the admin's decision, with history and undo.
- No online payments, SMS or WhatsApp, as asked.

---

## 8 Oct 2026 — Campus requests on every plan, Upgrade Plan, first campus at registration

**Asked:**
- the first campus is created automatically at registration;
- a New Campus Request is available on every plan, even at the campus limit;
- a My Schools page with plan and entitlement summary;
- an Upgrade Plan option for all owners, without fake payment;
- Super Admin review;
- security and tests.

**Architecture (unchanged decision):** campus = the existing `School`. There is no separate Campus model, because the School already is the tenant and every operational row hangs off `schoolId`. The first campus is the registered school itself: same id, same name, same approval lifecycle. `Organization` groups an owner's campuses.

**Changed:**

1. **First campus at registration.** The school, its first School Admin and its Organization are now created in **one transaction**, so a failed or retried registration leaves nothing half-made. A repeated registration with the same email is refused before writing. Approval reuses the organization (it no longer creates a second). `ensureOrganization` stays as the idempotent fallback for older/seeded schools, and the migration backfill covers existing schools.

2. **Campus requests on every plan.** Submission is no longer blocked by the campus limit or by modules/roles/limits outside the plan.
   - Those are saved on the request as `entitlementNotes` (e.g. "Campus limit: the plan includes 1; this would be campus 2", "Modules not in the current plan: Library").
   - The requester sees "You can still send a request — opening another campus needs a plan upgrade or extra campus entitlement".
   - **Activation is still refused past the campus limit**, and asking grants nothing.
   - Duplicate open requests are still refused.

3. **My Schools for every School Admin** (sidebar entry always shown; also on Settings). It shows:
   - current school;
   - current plan (with module/role counts);
   - campus entitlement (`used / limit`);
   - the entitlement message;
   - buttons **Upgrade Plan**, **My Campus Requests** and **Add New Campus Request**.

   The request form lists all modules and roles, marking the ones outside the plan "needs upgrade/approval". Client checks: required fields, email type, 6-digit PIN pattern, numeric limits; the server validates everything again.

4. **Upgrade Plan** (`/school-admin/plan`, also a Settings card).
   - It shows the current plan and campus entitlement, every active plan (price, campus limit, modules, roles, limits) with "Your plan" / "Upgrade" badges, "Request <plan>", and the request history.
   - **No online payment exists, so choosing a plan creates a `PlanChangeRequest` (PENDING).** Plan, modules, roles and campus entitlement do **not** change.
   - One open request per school; it can be withdrawn.
   - **Super Admin → Plan requests** (`/super-admin/plan-requests`, with a badge): Approve (moves the subscription through the existing `setSubscription`, so modules/roles follow unless adjusted for the school; claimed first, so a double approval changes it once) or Reject (reason required).
   - Audited: `PLAN_CHANGE_REQUESTED/APPROVED/REJECTED/CANCELLED`.

5. **Super Admin campus request review** now shows "Beyond the plan when requested" (entitlement notes) on the detail page, and "Needs entitlement" in the list. Approve / modify / reject and provision-once are as before.

**Migration:** `20261028090000_plan_requests` adds the `PlanChangeStatus` enum, the `PlanChangeRequest` table and `CampusRequest.entitlementNotes`. Applied to the local test DB only. **NOT applied to Neon.**

**Tested:**
- New `plan-upgrade.test.ts` (5 tests):
  - registration creates exactly one organization with the school as first campus; a repeated registration creates nothing; approval keeps the same organization;
  - every admin sidebar has My Schools;
  - the plan overview;
  - choosing a plan changes nothing (subscription, modules, campus limit) until approval, then changes once; duplicate/other-school/non-super-admin are refused;
  - rejection needs a reason; the same plan is refused; withdrawal works.
- `campuses.test.ts` was updated for the new rule:
  - a single-school owner can submit; the note is recorded; approval past the limit is refused;
  - beyond-plan modules/roles/limits are noted, not refused;
  - at the limit the request is accepted but activation is refused.
- Full suite: 100 files and 996 tests pass. tsc and eslint are clean, and the build passes.
- Hindi: 0 missing.
- Screenshots: My Schools (single school, Starter) and Upgrade Plan with a pending request.

**Not built / open:**
- Online payment or billing is not integrated. Upgrades are confirmed by the Super Admin and payment is arranged outside SchoolOS.
- A "Custom" plan is per school (Super Admin roles/limits/modules overrides plus the organization campus-limit override); there is no fourth plan tier.
- `npx prisma migrate deploy` on Neon (three pending migrations).

---

## 8 Oct 2026 — Campus requests: management UI, request history, safe migration

**Asked:** extend multi-campus with mandatory items:
- a working School Admin entry point and a complete request form;
- My Campus Requests (list + detail + history; no editing after review; no duplicates);
- the Super Admin review UI;
- a safe, idempotent migration for existing schools;
- provisioning exactly once;
- end-to-end verification.

**Changed:**

*Entry point*
- Settings has a new card, **My Schools / Campus Management** (always visible).
- `/school-admin/campuses` no longer redirects when multi-campus is off. It shows the school and the plan's limit ("Your current plan supports 1 campus…"), with no request button that cannot work.
- When requesting is allowed it shows **Request New School/Campus** and **My Campus Requests**.
- The request page shows the reason instead of redirecting.

*Request form*
- School details, contact and expected size (students / teachers / staff).
- Only the modules and roles the plan includes are shown.
- Requested limits: people counts and the switchable roles in the plan.
- A **Message / business justification** field.
- The same form edits a pending request.

*My Campus Requests*
- `/school-admin/campuses/requests` is a table: request ID, school, sent date, status, rejection reason, modules/roles/limits (approved ones once decided).
- `/school-admin/campuses/requests/[id]` shows requested vs approved side by side, the SchoolOS note, the rejection reason, a "now live" link, and the **History** from the audit log.
- `/…/[id]/edit` works **only while PENDING**. Once the request is under review or decided it is read-only, and the server refuses a change with "send a new request for any change".
- Duplicates are refused: a second open request with the same school name (case-insensitive), or a name that is already one of the organization's schools.

*Super Admin*
- The request detail now shows History and requested-vs-approved after the decision. Existing pages are unchanged otherwise.

*Provisioning once*
- Approval closes the request inside the same transaction only if it is still open with no school (`updateMany … createdSchoolId: null`). A racing second approval rolls its school back.
- `createdSchoolId` stays unique.
- The new campus has no users, students, staff, fees or attendance. Only the owner can switch into it.

*Migration*
- `20261027090000_campuses` backfill made explicitly idempotent:
  - only schools without an organization are touched;
  - `ON CONFLICT DO NOTHING` on the derived id `org_<schoolId>`;
  - the owner is assigned only if that login does not already own an organization;
  - the link is set only when the organization exists.
- School ids, slugs, names (no "Campus 1") and all operational rows are untouched.
- Still NOT on Neon. The file changed only in the not-yet-deployed migration; `prisma migrate status` on the test DB reports it up to date.

*Other*
- New audit action `CAMPUS_REQUEST_UPDATED`.
- The Settings → Principal hint no longer says "read-only".

**Migration:** no new migration. `20261027090000_campuses` was edited (backfill only) and is **NOT applied to Neon**.

**Tested:**
- New `campus-backfill.test.ts` (3 tests): runs the migration's backfill SQL on pre-organization schools.
  - Each school gets exactly one organization, owned by its first admin, with id, name and counts unchanged.
  - Running it twice more changes nothing.
  - Admin, teacher, parent and student logins still sign in to the same school.
- New `campus-request-flow.test.ts` (7 tests), end to end:
  - open → submit;
  - duplicates refused;
  - another school can't see or edit it;
  - edit while pending, then frozen after review;
  - modify & approve → requester sees status, approved config, note and history;
  - provisioned once and empty, with a second approval refused;
  - rejection reason visible and not editable;
  - existing data untouched, only the owner reaches the new campus.
- Full suite: 99 files and 991 tests pass. tsc and eslint are clean, and the build passes.
- Hindi: 0 missing.
- Screenshots: My Campus Requests, a request detail with history, and a single-school My Schools page.

**Open:**
- `npx prisma migrate deploy` on Neon (both pending migrations).
- There is no "amendment" request type for changes after approval. A changed setup goes through the Super Admin's school page or a new request.
- A requester cannot withdraw a request; it would need a new status in the schema.

---

## 8 Oct 2026 — Multi-campus: owners, campus requests, plan roles & limits

**Asked:** the "Multi-campus/multi-school SaaS model" spec.
- One owner can run one school or several campuses. Each campus is an independent school with its own data.
- A campus switcher and an owner-only "All Campuses" summary.
- New campuses come only through a request that the Super Admin approves, modifies or rejects.
- Plans control modules, roles, role/user limits and the campus limit.
- Everything is enforced on the server, and single-school users see no change.

**Design (built on the existing architecture):**
- **Campus = the existing `School`.** No second school entity was added. All operational data was already scoped by `schoolId` (`ctx.db`), so campus isolation is the existing tenant isolation.
- **New `Organization`** (an owner and their campuses).
  - The owner is a School Admin with `Organization.ownerId`; they never get platform power.
  - The migration backfill gives each existing school exactly one organization, owned by its earliest School Admin. No operational rows or IDs change.
  - New registrations create the organization automatically; registration does not ask about campuses.
- **Campus switching:** a `Session.activeSchoolId` column.
  - `validateSessionToken` honours it only for a SCHOOL_ADMIN who owns the organization, and only while that campus is ACTIVE. A tampered or foreign id falls back to the home school.
  - The client's campus id is never trusted. Every page and action then runs with that campus's `ctx.db`.
- **Plan** gains `campusLimit` (default 1, so multi-campus is **off** until the Super Admin raises it), `availableRoles` and `roleLimits`.
- **School** gains `enabledRoles`, `rolesCustomized` and `roleLimits`; it follows its plan unless adjusted, like modules.
- The Super Admin can override one organization's campus limit (`Organization.campusLimitOverride`).
- Roles are the fixed system roles: Principal plus the staff designations. School Admin, Teacher, Parent and Student are always on. No custom roles were added.

**Enforcement (server):**
- `server/platform/entitlements.ts`:
  - `assertRoleAvailable` (Principal creation and re-activation, staff create/designation change, staff wizard);
  - `assertWithinLimit` (students and teachers as before, plus STAFF, PRINCIPAL and per-designation limits), with a clear message such as "Your Pro plan allows up to 1 principal (1 in use)".
- `server/campuses/requests.ts`:
  - requests are checked against the campus limit (counting pending requests), and plan modules, roles and limits;
  - messages include "Your current plan supports 1 campus…" and "Library is not included in your current plan.";
  - approval also refuses past the campus limit.
- `server/platform/campuses.ts`: `switchCampus`, `allCampusesSummary` (owner-only; per-campus counts, attendance today, fee collected/pending via each campus's own finance snapshot, leave waiting — no detailed records), and `setCampusLimitOverride`.
- When there is no live plan, a request may ask for what the first campus already has. This matches the earlier rule that a missing subscription never blocks a school.

**Workflow:**
- Owner or School Admin → My Schools → **Request New School/Campus** (details, modules, roles and expected limits; only what the plan includes can be ticked) → status PENDING.
- Super Admin → **Campus requests** (badge count) → Mark under review / Approve / **Modify & approve** / Reject (a reason is required).
- Approval creates the school as ACTIVE in the same organization:
  - on the organization's plan, with the approved modules, roles and limits;
  - with the default academic setup only (classes, streams, subjects, current session) — no fake people.
- The requested and approved configurations are both stored. Status becomes APPROVED or MODIFIED.
- Audited: CAMPUS_REQUEST_CREATED / UNDER_REVIEW / APPROVED / MODIFIED / REJECTED, CAMPUS_ACTIVATED, ORGANIZATION_CAMPUS_LIMIT_CHANGED, SCHOOL_ROLES_CHANGED, SCHOOL_LIMITS_CHANGED, and PLAN_UPDATED (now includes roles, limits and campus limit).

**Pages:**
- `/school-admin/campuses` — My Schools: All Campuses summary, campus cards with "Open", and request statuses. Only when multi-campus is on; otherwise it redirects to the dashboard, and the nav entry is hidden.
- `/school-admin/campuses/request`.
- The sidebar campus switcher appears only for an owner with 2 or more live campuses.
- `/super-admin/campus-requests` and its `[requestId]` page.
- Plans & Features: roles, role limits and campus limit per plan.
- The school page gained "Roles & limits" and "Owner & campuses" (campus limit override).
- The staff wizard offers only the designations the campus has.

**Migration:** `20261027090000_campuses` (new tables, columns and the backfill SQL). Applied to the local test DB only. **NOT applied to Neon.**

**Tested:**
- New `campuses.test.ts` (12 tests):
  - single school: no multi-campus, and a request is refused;
  - plan module, role and limit checks;
  - pending request; only the Super Admin decides; another owner is refused;
  - reject needs a reason;
  - modify & approve keeps the request and creates a provisioned campus with no students;
  - the owner switches campus and sees only that campus's data;
  - a foreign or made-up campus is refused; a tampered `activeSchoolId` falls back home;
  - All Campuses is owner-only and summary-only;
  - a non-owner admin and a Principal cannot switch;
  - a disabled role or module is refused;
  - a Principal limit stops the second one;
  - the campus limit cannot be bypassed;
  - a campus-A Principal never sees campus-B students.
- Full suite: 97 files and 981 tests pass. tsc and eslint are clean, and the build passes.
- Hindi phrases: 0 missing.
- Screenshots: owner My Schools with the switcher; a single-school admin, unchanged (no switcher or entry); the Super Admin request review; the request form on a phone.

**Open / decisions to confirm:**
- Run `npx prisma migrate deploy` on Neon (both pending migrations).
- After the backfill every plan has campus limit 1, so multi-campus is off everywhere until the Super Admin raises a plan's (or an organization's) limit.
- The owner works in a second campus as its School Admin. There is no separate login for that campus's own admin; the Super Admin can add one from the school page.
- "All Campuses" is a summary page, not a mixed operational context.
- Hostel and Visitors are not optional modules (Hostel doesn't exist; Visitors is core).
- Core roles cannot be switched off.
- Role limits are checked when someone is created or re-activated, not when the Super Admin lowers a limit below current use.

---

## 8 Oct 2026 — Principal as a working school leader; Responsibilities

**Asked:** the "Principal Dashboard, Workspace & Responsibility Workflow" spec. The Principal is not a read-only reporting role. They add and edit students and teachers, run academics, attendance, homework, exams and communication, review leave, and assign responsibilities. Finance is an overview only, and they never get platform access. The School Admin gets a Principal workspace and keeps doing everything when there is no Principal.

**This reverses the earlier "read-only Principal" design** (the roles entry on 7–8 Oct). The read-only `/principal/attendance|teachers|exams|reports|notices|events|meetings|holidays` pages were removed. The Principal now works in the same `/school-admin/...` pages, under their own sidebar.

**Changed:**

*Permissions (`src/lib/permissions.ts`)*
- PRINCIPAL can view, create, edit, approve, publish and export across students, staff, attendance and exams.
- PRINCIPAL has every action on academics, homework, communication and responsibilities.
- Finance is VIEW only. Reports are VIEW and EXPORT.
- The Principal has no DELETE on students or staff, and no settings or users area.
- The new area `responsibilities` is shared by the School Admin and the Principal.
- `PRINCIPAL_GRANTS` covers the staff-grant checks the Principal passes: fee overview, student directory, enquiries and admissions, and meetings.

*Server checks*
- About 180 admin-only checks became `assertCan(ctx, area, action)`, and the matching pages and actions accept `PRINCIPAL`. Everything else still refuses the Principal, as before:
  - fees collection and configuration, payroll and expenses;
  - staff grants and profiles, settings, website, library, inventory, transport and visitors;
  - audit;
  - the Principal login itself;
  - deleting students and teachers;
  - school settings: attendance timing, the leave back-date rule, the needs-attention rule and the admission portal now need `settings`. Those forms are hidden for the Principal, and the rule is shown as text instead.
- **Security fix found during this work:** `assertCan` now passes only school leaders (School Admin or Principal) with **school-wide** scope. Before this, a teacher's ASSIGNED or a parent's CHILDREN permission satisfied those checks. 15 existing tests caught it, for example a teacher reading the admin homework overview, or a parent reading lesson files. All 15 pass again.
- The rule that results publish only once every mark is in also applies to the Principal.

*Responsibilities (new)*
- New `Responsibility` model, statuses PENDING, IN_PROGRESS, COMPLETED, OVERDUE and CANCELLED, priority LOW, NORMAL and HIGH.
- Predefined types live in `src/lib/responsibilities.ts`.
- `src/server/responsibilities/service.ts` handles create, edit, reassign, cancel, confirm and send back. The assignee's start, progress and complete work only on their own records.
- Overdue is computed from the due date.
- Assignees can only be this school's teachers, staff or Principal, checked on the server, and never yourself.
- A Principal cannot manage a responsibility given to them; the School Admin reviews those.
- Every step is audited (`RESPONSIBILITY_*`, module "Responsibilities").
- A responsibility grants no access.
- Pages:
  - `/school-admin/responsibilities` for the School Admin and the Principal: tabs All, Given to me, Given by me, Pending, Overdue, Completed and Cancelled, plus an assign form, edit/reassign, cancel, confirm and send back;
  - `/teacher/responsibilities` and `/staff/responsibilities` ("My responsibilities") for assignees;
  - a dashboard card for teachers and staff when something is open.

*School Admin → Principal workspace (new)*
- `/school-admin/principal` shows the Principal's details and login state, the responsibilities they hold (active, pending, completed, overdue) and the ones they delegated, and their recent actions from the audit log.
- With no Principal it shows "No Principal Assigned — School Admin currently manages Principal responsibilities", with Add a Principal and Responsibilities buttons.
- The admin sidebar gained Responsibilities and Principal.

*Principal dashboard (rewritten)*
- Ten quick actions: Add Student, Add Teacher, Create Notice, Organize PTM, Create Event, Schedule Exam, Assign Responsibility, Review Leave, Review Results, View Reports.
- A. School overview: students, teachers and staff, attendance today, teacher attendance, classes and sections, and the fee overview.
- B. Academics: progress, lessons taught (recorded classes, standing in for syllabus progress), weak students, class and subject performance.
- C. Teachers: in today, on leave, class-teacher and subject-teacher coverage, workload.
- D. Exams: upcoming, in progress, marks pending, ready to publish.
- E. Attendance: 7-day trend, classes under 75%, students absent 3+ days this week.
- F. Responsibilities summary.
- G. School updates (notices, events, meetings, leave).
- The Principal sidebar: Dashboard, Students, Teachers & Staff, Academics, Attendance, Homework & Learning, Exams & Results, Communication, Calendar, Leave, Responsibilities, Reports, Profile.
- Principal alerts now link to the `/school-admin` pages.

**Migration:** `20261026090000_responsibilities`. Applied to the local test DB only. **NOT applied to Neon.**

**Tested:**
- `principal-role.test.ts`, rewritten (9 tests):
  - the Principal adds a student and a teacher (audited as PRINCIPAL), creates a notice, a PTM and an event, cancels the PTM, and schedules an exam;
  - publishing is blocked while marks are missing, for both the Principal and the admin;
  - deleting people, fees, payroll, staff grants, settings and the Principal login are refused;
  - the empty workspace without a Principal, and tenant isolation.
- New `responsibilities.test.ts` (8 tests):
  - the full flow, overdue, reassign and cancel;
  - a teacher cannot assign or touch others' records;
  - assignees limited to this school's staff;
  - admin oversight, and no self-review by the Principal;
  - works without a Principal;
  - cross-school records not found.
- `i18n-nav.test.ts` updated for the new admin entries.
- Full suite: 96 files and 969 tests pass. tsc and eslint are clean, and the production build passes.
- Hindi phrases merged: 0 missing.
- Screenshots checked: the Principal dashboard, Responsibilities (Principal), the admin Principal workspace with and without a Principal, and a teacher's My responsibilities on a phone.

**Open:**
- Run `npx prisma migrate deploy` on Neon.
- There is no syllabus model, so "Lessons taught" (recorded vs missed classes over 30 days) stands in for syllabus completion.
- Responsibilities are shown on dashboards but there are no notifications or emails for them yet.

---

## 8 Oct 2026 — Fix: Principal login said "wrong email or password"

**Asked:** the Principal account would not sign in ("email/password wrong") — fix it.

**Found:**
- The live Neon database already has all 50 migrations, including `20261025090000_principal_role`. `prisma migrate status` reports "up to date", so the earlier "pending on Neon" notes no longer apply.
- But there was **no PRINCIPAL user at all**: the demo seed (which adds them) had not been re-run since the role was added.

**Changed (live Neon, additive only):**
- Created two Principal logins. Nothing existing was modified or deleted; the demo seed was **not** re-run, because it recreates the demo schools.
  - `principal.demo-sunrise@schoolos.dev` — Sunrise Public School
  - `principal.demo-greenvalley@schoolos.dev` — Green Valley Academy
- Password: the demo password, bcrypt cost 12. `activatedAt` is set and `mustChangePassword` is true, so the first sign-in asks for a new password.
- No account was created for Sankeswar (a real school). Its School Admin adds one at Settings → Principal (needs working SMTP for the activation email).

**Tested:**
- bcrypt compare of the demo password against both stored hashes: OK.
- A real sign-in on the running dev server (localhost:3000, against Neon) as the Sunrise Principal landed on `/account?changePassword=required`, as designed. This left one session row for that account.

**Migrations:** none new.

---

## 8 Oct 2026 — Roles and responsibilities: the Principal, and one permission table

**Asked:** align roles, responsibilities, dashboards, navigation, data scope and backend authorization with the role spec — reusing the architecture, with no parallel systems. Add a PRINCIPAL role with a development seed account (SchoolOS@2026, hashed, changed on first sign-in).

**Inspected — already in place and kept:**
- **Tenant isolation:** `ctx.db` is always one school, and `schoolId` comes from the session.
- **Data scope:**
  - teacher: `accessibleSectionIds` and `requireTeacherSelf`;
  - parent: `listMyChildren` / `requireChild`;
  - student: `findStudentSelf`.
- **Staff permissions:** module × action grants, plus School Admin workspaces.
- **Super Admin and optional modules:** from earlier today.
- **Nursery–5 and 6–12 login rules:** session → class → section → optional stream → subject → teacher.
- **Result publication:** blocked until every paper's marks are in (`publishExams` → `publishBlocker`).
- **Students and fees:** students never see fees. There is no student fee page or nav. The dormant `School.showFeesToStudents` column is not used by any screen.

**Changed:**
- **Central permission table** (`lib/permissions.ts`): role → area → actions (VIEW / CREATE / EDIT / DELETE / APPROVE / PUBLISH / EXPORT) → scope (PLATFORM / SCHOOL / ASSIGNED / CHILDREN / SELF / GRANTED).
  - Checked with `assertCan` (`server/auth/permissions.ts`).
  - Shared read services moved from a hard-coded `SCHOOL_ADMIN` to `assertCan`:
    - `academicSnapshot`, `financeSnapshot` and `staffToday`;
    - `listExams` and `testCounts`;
    - `schoolReport` and all 9 report builders in `reports/exports.ts`;
    - `supportSummary` and `peopleSummary`.
  - Staff stay on their grants. The Principal holds only `fees.view` among staff grants, for the fee overview.
- **New PRINCIPAL role** (`UserRole.PRINCIPAL`): academic leadership and oversight of one school, read-only.
  - **Area `/principal`:**
    - **Dashboard:** total students, attendance today, teacher attendance, upcoming exams, academic progress, pending results, students needing attention, fee overview (when the school has Fees), class performance, "Worth a look" alerts, school updates.
    - **Attendance:** by class today, teachers, 30-day trend.
    - **Classes:** attendance over 30 days and test average over 60, with low figures flagged.
    - **Teachers:** subjects, class-teacher roles, today's attendance.
    - **Exams & Results:** stage and marks entered.
    - **Reports:** the shared screen. No fee, expense or salary downloads; the export route enforces it.
    - **Notices / Events / Meetings (PTMs included) / Calendar:** school-wide visibility.
    - **Profile:** `/account`.
  - **Cannot:** admit students, collect or charge fees, run payroll, decide leave, open student records, or manage users and settings. Admin and platform URLs redirect to the Principal's dashboard.
  - **Alerts:** `getPrincipalAlerts` (absences, missed classes, marks pending, results ready, plus notices, holidays and meetings) in the notification center.
  - **Wiring:** role home, label and profile, tenant roles, proxy prefix, nav and mobile bar, and the account, notification, notice-read and photo endpoints.
  - **School Admin → Settings → Principal** (`/school-admin/settings/principal`): create a Principal login (activation email; they choose the password, never shown), close or reopen it. Audited with `PRINCIPAL_CREATED`.
- **Forced password change:** new `User.mustChangePassword`.
  - Page guards send such a user to `/account?changePassword=required` (with a banner); actions and exports refuse.
  - Changing the password clears the flag.
- **Dev seed:** `scripts/seed-demo.ts` adds a Principal per demo school (`principal.<slug>@schoolos.dev`). It uses the existing hashed demo password (SchoolOS@2026) with `mustChangePassword: true`.
  - Nothing in the app shows or returns it.
  - The seed script itself still prints the shared demo password, as it always has for every demo account.
  - It was **not run** here, because it writes to `.env`.
- **Super Admin, as the spec names things:**
  - "Plans & Features" and "Platform Settings" labels.
  - The dashboard adds Platform alerts (pending approvals, unverified emails, suspensions, new enquiries), school growth over 6 months, and module adoption.
- **Hindi:** for everything new.

**Migration:** `20261025090000_principal_role`, which adds the enum value and `User.mustChangePassword` (default false). Test DB only. **NOT applied to Neon.**

**Tested:**
- New `tests/integration/principal-role.test.ts` (6 tests) covers:
  - the permission table (Principal view-only; Student has no finance; Super Admin has no school areas);
  - the Principal reads classes, teachers, attendance, exams, reports, the fee overview and alerts;
  - the Principal is refused admissions, fee collection, fee heads, payroll, leave decisions, the student list and Principal management;
  - School B's Principal sees nothing of School A;
  - the School Admin creates a Principal login (activation, audit, duplicate refused, teacher refused);
  - a default password change clears `mustChangePassword`.
- Full suite: 95 files, 958 tests passing.
- tsc, eslint and the build are clean.
- **In the browser:**
  - every `/principal` page returns 200;
  - a fee download returns 404;
  - admin and platform URLs redirect;
  - the forced-change banner shows;
  - screenshots of the dashboard, Attendance and Reports.

**Not done (honest):**
- Hostel module — it does not exist in the product.
- Configurable approvals for the Principal (for example leave) — the spec says "where applicable"; nothing is configured.
- A Principal search box.
- Principal access through the REST API beyond its own profile, alerts and notices.

---

## 8 Oct 2026 — Super Admin: dashboard, approvals, features & plans

**Asked:** a production-ready Super Admin area that manages schools and the platform — never a school's daily work. Reuse what exists; keep platform and school roles separate; enforce on the backend.

**Already there (reused, not rebuilt):**
- School statuses: PENDING, UNDER_REVIEW, ACTIVE, SUSPENDED, REJECTED, INACTIVE.
- The approve / reject / suspend / reactivate transitions, all audited.
- On approval: school provisioning and creation of the first admin. Suspension signs everyone out.
- Plans: one per tier, STARTER / STANDARD / PRO, with names, prices and limits editable. Subscriptions.
- The platform audit log, scoped to platform actions.
- The school detail page, with admins and email verification.
- Website enquiries and offers.

**New: optional modules, per plan and per school** (`lib/school-modules.ts`, `server/platform/modules.ts`):
- **Core modules** are always on, with no switch: Students, Teachers & staff, Academic structure, Attendance, Homework & learning, Exams & results, Parents, Communication, Basic reports, School settings.
- **Optional modules** are only the ones that exist in the product: **Fees & finance, Expenses, Payroll, Library, Transport, Inventory**. Hostel and Advanced reports do not exist yet, so they cannot be switched on. Unknown keys are always dropped.
- **Schema:**
  - `Plan.optionalModules`.
  - `School.optionalModules`, which defaults to all modules so no existing or fixture school loses anything.
  - `School.modulesCustomized`.
- **Plans keep their editable names.** Tiers start with: Starter = Fees; Standard = Fees, Expenses, Payroll, Library; Pro = all six. "Custom" is a set of modules adjusted for one school.
- **How a school gets its modules:**
  - **Approval:** from the chosen plan, or a set adjusted at approval.
  - **Plan change:** a school that follows its plan takes the new plan's modules.
  - **Editing a plan's modules:** reaches the schools that follow it, not those adjusted by hand.
- **Enforcement (backend first):**
  - Staff grants in a module the school lacks are dropped (`staffGrants`), so nav, pages and services all see the same thing.
  - `assertAdminOrStaffPermission` refuses for the **School Admin too**.
  - 29 admin-only module services gained an explicit `assertModuleEnabled`.
  - Module pages have a `ModuleGate` layout ("… is not part of your school's plan"); that includes receipts.
  - CSV exports from a missing module are refused.
  - Sidebars and tab rows hide those modules for every role.
  - Dashboards, alerts, Needs action, the setup checklist, staff and teacher profiles, the student page and the parent child page all skip missing modules instead of failing.

**Super Admin UI:**
- **Sidebar:** Dashboard, Schools, Approvals (badge with the pending count), Features & Plans, Platform Reports, Audit Logs, Settings. The existing Enquiries and Offers sit under "Website". There are no school-operation entries.
- **Dashboard:**
  - Four KPIs: Total, Active, Pending approval, Suspended.
  - A secondary strip: Students, Teachers, Parents, Active academic sessions.
  - **Recent school registrations** (name, location, date, admin, status), with Review / Approve / Reject or View, and "View all schools".
  - Platform activity.
  - The charts moved to Reports. The per-school "school list" tracker and its fee totals were removed from the dashboard (`features/platform/school-tracker.tsx` deleted; `schoolTracker` stays in analytics for its tests).
- **Schools:** tabs All / Pending approval / Active / Suspended / Rejected, plus search.
- **Approvals** (new): every pending school with its code, location, registration date, contact, school admin, requested plan, board and email verification, and Review / Approve / Reject. Approve and Reject open the school's review (`#approve` / `#reject`). The page states plainly that student and class numbers are not collected at registration.
- **School detail:**
  - Approval is now **plan → features → approve**: a plan picker, the core list, the plan's optional modules, and "Adjust for this school".
  - New **Feature access** card: "Follow the {plan} plan", or tick modules for this school, then Save changes.
  - New **Academic overview**: current session, classes, sections, principal.
  - Registration details now show the school code (slug / UDISE), address, phone and email.
- **Features & Plans:** the core list, "optional modules in use" bars (adoption), and each plan's price, limits and optional modules.
- **Platform Reports** (new): totals, new this month, pending, suspended; students, teachers and parents across schools; growth over 12 months; status; module adoption; plan mix; largest schools.
- **Audit Logs:**
  - New **Previous → new** column, filled from `{from, to}` or `{previous, next}`.
  - "By" shows the name and role.
  - New actions: `SCHOOL_PLAN_CHANGED`, `SCHOOL_MODULES_CHANGED` (enabled and disabled lists). `PLAN_UPDATED` now records module changes and how many schools followed. `SCHOOL_APPROVED` records the plan and modules.
- **Settings** (new): platform-level only, linking to things that exist — profile, password and language; API tokens; plans and feature configuration; security and audit; homepage offers; enquiries; the public homepage. No fake switches for things that don't exist (such as notification settings).
- **Hindi:** for everything new.

**Migration:** `20261024090000_school_modules`. It adds the columns, gives each plan its tier's modules, and sets **all modules on every existing school** (marked as set by hand), so live schools keep everything. Applied to the local test DB only. **NOT applied to Neon.**

**Tested:**
- New `tests/integration/school-modules.test.ts` (6 tests) covers:
  - approval with a plan sets that plan's modules, with the audit;
  - modules adjusted at approval are kept, and unknown keys are dropped;
  - Manage features changes one school only, audits enabled/disabled and previous → new, and switches back to "follow plan"; a School Admin is refused;
  - a plan's modules reach followers and not adjusted schools; a plan change moves a follower;
  - with Fees and Payroll off: the admin's fee and salary services refuse, the accountant's fee grants vanish, and Needs action and admin and parent alerts still load with no fee alerts;
  - the other school keeps everything.
- Full suite: 94 files, 952 tests passing.
- tsc, eslint and the build are clean.
- Screenshots: Super Admin dashboard, Approvals, a pending school's review, Features & Plans and Reports; a School Admin with only Library (sidebar, dashboard, the "not part of your plan" page). A temporary fixture was used and removed.

**Open:**
- 12 migrations are now pending on Neon (`20261014…` to `20261024…`).
- Not built:
  - a stored platform-settings model (no real setting needed one yet);
  - Hostel and Advanced reports modules;
  - registration asking for student and class numbers.

---

## 7 Oct 2026 — Salaries the accountant pays now show for the admin

**Asked:**
- When the accountant paid Alok the driver's salary, it did not show on the admin dashboard.
- Show how much was paid this month, how much is left, and who paid it, all in the audit log too.
- Fix anything wrong found along the way.

**What was wrong:**
1. The admin dashboard's Money section showed only fees and expenses. Salaries were not there at all.
2. Payroll showed "Paid {date}" but not **who** recorded the payment, and "Still to pay" was a head-count, not an amount.
3. The `PAYROLL_PAID` audit entry held totals only ("1 teacher and 1 staff paid, ₹X"), on purpose. So the audit log never said who was paid what.

**Changed:**
- **Admin dashboard — new "Salaries — {month}" section,** after Money:
  - Paid this month (₹ and number of people), Still to pay (₹ and number of people), Salary bill.
  - "Paid this month": each person with role, amount, date and **by whom** (for example "Paid 7 Oct 2026 by Ravi Gupta (Accountant)").
  - "Not paid yet": each person with role and amount due.
  - It reads `getPayroll`, so it is the same data as Payroll.
- **Payroll (admin and staff):**
  - Each paid row says "by Ravi Gupta (Accountant)" or "by … (School Admin)". Built with the new `recorderLabel` / `RECORDER_SELECT`.
  - "Still to pay" is now an amount: the new `totals.remainingMinor`, the sum due for everyone not yet paid. The number of people is the hint.
- **Audit:**
  - `PAYROLL_PAID` now names each person with role and amount, plus the month, date, method and reference: "Salary for October 2026 paid on 7 Oct 2026 (Bank transfer, ref UTR123): Alok Kumar (Driver) ₹15,000 — ₹15,000 in total." The actor is whoever paid (Accountant or Admin). `metadata.payees` lists each person.
  - `SALARY_PAID` (a single payment) now includes the month, date and method.
  - **Reverses an earlier choice:** payroll audit entries used to hold totals only, on purpose. Salary structure changes still never show the figure.
- **Hindi:** for the new text.

**Migrations:** none.

**Tested:**
- New `tests/integration/salary-visibility.test.ts` (4 tests) covers:
  - the accountant pays Alok: the admin's payroll shows `paidBy "Ravi Gupta (Accountant)"`, the paid total and the remaining amount;
  - the audit names Alok (Driver) ₹15,000 with the method and reference, and the actor is the accountant;
  - an admin single payment shows as "(School Admin)" and is audited with the month;
  - another school sees nothing.
- `staff-payroll.test.ts` was updated for the named audit.
- Full suite: 93 files, 946 tests passing.
- tsc, eslint and the build are clean.
- `homework-resources.test.ts` failed once under full-suite load and passed alone and on a full re-run — a flaky test, not related.
- Screenshots of the dashboard's Salaries section and the audit log, using a temporary fixture that was removed afterwards.

---

## 7 Oct 2026 — The same child is never added twice without the admin deciding

**Asked:**
- Build both gaps from the previous check.
- When a student being added matches one already at the school, there must always be a warning, and the admin must be able to choose to add or reject at that moment.

**Changed:**

- **One matching rule** (`lib/student-duplicates.ts` and `server/people/duplicates.ts`):
  - A possible duplicate is a student with the **same full name**. Case, extra spaces and punctuation are ignored.
  - Same name plus the **same date of birth** or the **same parent mobile** is marked "Very likely the same child".
  - Same name with a different date of birth still warns, and says so.
  - Only this school's students are read.

- **Add student, and admission from an application or an enquiry:**
  - `createStudent` checks before anything is saved. The form then shows a **warning panel** with each match: name (opens their profile), admission number, class, status, date of birth, parents, and why it matched.
  - The admin chooses:
    - green **"Yes, different child — add as a new student"** resubmits with `confirmDuplicate`;
    - red **"No, same child — don't add"** goes back to the Students list, the application or the enquiry.
  - Adding anyway is written to the audit log: "Added after the possible-duplicate warning, confirmed as a different child: … (ADM-…)", with `metadata.confirmedDuplicateOf`.
  - The application and enquiry conversions used to have their own name-only check with a "This is a different child" tick box. They now go through the same check and panel; the conversion pages show a "Heads up" note in advance.
  - The API path `acceptApplication` (POST `/api/v1/admissions/:id/accept`) is refused with the matches unless `confirmDuplicate: true` is sent.

- **Spreadsheet import** (`importStudents`):
  - Each row is compared with the school's students and with earlier rows of the same file (the same child typed twice).
  - The preview lists **possible duplicates** in a separate box, one tick box per row. Unticked rows are **left out**; ticked rows are added. The Import button counts them.
  - The report and the audit entry say how many were added after confirmation and how many were left out.

- **Old and new students:**
  - Students admitted since the current session began show a green **New** badge in the Students list (phone and desktop).
  - New filter **"Admitted"**: "New this session" or "Admitted in {year}" (years from the data). The pager keeps all filters.

- **Hindi:** for all new text.

**Migrations:** none.

**Tested:**
- New `tests/integration/student-duplicates.test.ts` (8 tests) covers:
  - name and birthday give "very likely", and nothing is saved;
  - a different birthday still warns; case and spaces are ignored;
  - the same parent mobile gives "very likely";
  - Add anyway, with the audit entry;
  - a different name adds without warning;
  - another school never matches;
  - import preview with a duplicate on file and in the file, a ticked twin added, an unticked row left out, and the audit;
  - the New flag, the New filter and the year filter.
- `admissions.test.ts` adds: the API accept is refused with matches until confirmed.
- `people.test.ts` was adjusted: its roll-number test now confirms the duplicate.
- Full suite: 92 files, 942 tests passing.
- tsc, eslint and the build are clean.
- **In the browser:** filled the Add student form for an existing child, saw the panel, clicked "Yes, different child", and the child was added as ADM-2026-00002 with the audit note. The Students list was screenshotted showing New badges. A temporary fixture school was used and removed afterwards.

---

## 7 Oct 2026 — Check: can old and new students get mixed up?

**Asked:** whether old and new students can get mixed up, and whether each student has a unique identity that makes them easy to find.

**Checked (no code changed):**
- **Unique ID:** every student has an admission number, unique within the school (`@@unique([schoolId, admissionNumber])`).
  - New admissions get `ADM-{year}-{00001}` from a per-year counter. A number is never reused, and promotion or a new session never changes it.
  - Imported students may keep their old school number. A number already taken is refused.
- **Old vs current:** current students have status ACTIVE or ON_LEAVE. Left students have TRANSFERRED, GRADUATED, WITHDRAWN or INACTIVE, and the list shows only current students by default. Each year's class placement is a separate enrollment, so history is not overwritten.
- **Finding a student:** the Students list and the header search work by name, admission number, parent name or parent mobile/email.
- **Gaps found:**
  1. No "new admissions" filter or badge (by admission year or session).
  2. No warning when the same child is added twice (same name + date of birth, or same name + parent mobile). Parents are de-duplicated, students are not; bulk import checks admission numbers only.

These were offered to the user; not built yet.

**Migrations:** none.

---

## 7 Oct 2026 — Visitor date and time filled in automatically

**Asked:** when a visitor arrives today, the date should be filled in automatically. Tomorrow's or an earlier date must not be enterable, and the time must be today's too.

**Changed:**
- **Log a visitor:**
  - The "Entry time" date-time box is gone. In its place is a read-only **"Date & time — Today, now — filled in automatically"**.
  - The server stamps the entry with the moment it is saved. A date or time sent by the browser is ignored, because the field no longer exists in `visitorEntrySchema`.
  - Turned-away visitors are stamped the same way.
- **Mark out:** always stamped "now". `visitorExitSchema` and `markVisitorExit` no longer take a time.
- **Correcting a visit:**
  - The Entry/Exit time boxes are removed. Details and status can still be corrected, and the stamped times never change.
  - Setting "Left" on someone still inside marks them out now.
  - A note on the form says so.
- **Removed as no longer used:** the datetime parsing in `lib/validation/visitors.ts`, the `checkTimes` and future-slack checks in `server/operations/visitors.ts`, and `toSchoolDateTimeInput` in `lib/dates.ts`.
- The "Day" picker on the visitor list stays. It only chooses which day's log to view.
- **Hindi:** 3 new phrases.

**Migrations:** none.

**Tested:**
- `receptionist-security.test.ts` was rewritten for this case:
  - an entry sent with "2026-01-01 09:00" is stamped now;
  - exit is stamped now, and never before the entry;
  - a correction that sends other times changes neither time;
  - the audit lists only the real changes.
- Full suite: 91 files, 933 tests passing.
- tsc, eslint and the build are clean.
- The visitor form was screenshotted at 390px, using a temporary fixture that was removed afterwards.

---

## 7 Oct 2026 — Admin gets clear Approve and Reject buttons on student leave

**Asked:** after the class teacher approves a student's leave, the admin (principal) must still have both buttons, Approve and Reject, because the admin's approval is still pending.

**Checked:**
- The admin already had both buttons on requests the class teacher had approved (`mayDecide` is true for every status except Cancelled).
- But Reject was a small plain outline button that was easy to miss.

**Changed:** in `LeaveDecisionForm`, the decision now sits in its own box with a heading that says whose decision it is:
- "Class teacher approved — your final decision" (after the teacher's approval);
- "Your decision (final)" (before the teacher has reviewed it);
- "Change the final decision" (already decided);
- "Your review" (the class teacher).

The buttons are full size, with icons: a green **✓ Approve (final)** and a red **✕ Reject**. The class teacher sees "Approve & send to school" and Reject. Hindi was added.

**Migrations:** none.

**Tested:**
- `student-leave-two-step.test.ts` now has 6 tests. New checks:
  - after the teacher approves, the admin's row has `mayDecide: true` and the teacher's has false;
  - the admin can reject a teacher-approved request, the family sees the rejection with the admin's comment, and the teacher's approval stays on record.
- Full suite: 91 files, 933 tests passing.
- tsc, eslint and the build are clean.
- The admin screen was screenshotted, using a temporary fixture that was removed afterwards.

**Note:** this needs migration `20261023090000` on the database. On a database without it (Neon today), the leave pages will error.

---

## 7 Oct 2026 — Leave back in the admin sidebar; two-step student leave

**Asked:**
- Why was the Leave section removed from the admin sidebar? Put it back.
- Staff and teacher leave must reach the admin.
- Student leave from a parent or student must go to the class teacher and the admin. After the teacher approves, the admin's approval is required.

**What was already true:** staff and teacher leave (`LeaveRequest`) is decided only by the School Admin. On 7 Oct the sidebar entry was folded under Attendance, so it was hard to find. That part of the earlier sidebar change is reversed here.

**Changed:**
- **Sidebar:**
  - **Leave** is its own entry again under Daily work, after Attendance. Tabs: Staff leave & cover, then Student leave.
  - It shows a red **badge** with the requests waiting for the admin: staff/teacher leave pending, plus student leave approved by the teacher. New helpers: `adminNav()` and `NavItem.badge`.
- **Two-step student leave.** New status `TEACHER_APPROVED`, plus the class teacher's review fields `teacherReviewedById`, `teacherReviewedAt`, `teacherApproved` and `teacherComment`. How it works:
  - **Request:** a parent or student applies. Status is `PENDING`, shown as "With class teacher".
  - **Teacher approves:** status becomes `TEACHER_APPROVED`, shown as "Waiting for school approval". The family gets an alert: "approved by the class teacher… waiting for the school's final approval".
  - **Teacher rejects:** status becomes `REJECTED`. This is final unless the admin overturns it; the teacher's decision is kept.
  - **School Admin:** gives the **final approval** (`APPROVED`) or rejects. The admin may also decide before the teacher (for example when there is no class teacher, or it is urgent), and may overturn any decision.
  - **Only `APPROVED` is leave:** the register, calendar and "On leave" status show nothing before it.
  - **Cancelling:** the family can cancel while the request waits, or before an approved leave starts.
  - **Audit:** the new action `STUDENT_LEAVE_TEACHER_APPROVED`. Admin summaries say whether the admin acted before or after the teacher.
- **Every leave card** now shows both steps with ✓ / ✕ / … markers: 1. Class teacher — who, when, comment. 2. School approval — waiting, done, or not needed.
- **Buttons:** the teacher sees "Approve & send to school"; the admin sees "Give final approval".
- **Admin Student leave page:**
  - Stat cards: Waiting for your approval, With class teachers, Approved, Rejected/cancelled.
  - Tabs: Waiting for you / With class teacher / Approved / Rejected.
- **Teacher page:** tabs To review / Sent to school / Approved / Rejected / All.
- **Admin alerts and Needs action:**
  - "N student leave requests approved by the class teacher, waiting for your final approval".
  - The staff leave line now says "staff leave".
- **Wording:** the parent and student pages and the form explain the two steps.
- **Hindi:** all new text.

**Migration:** `20261023090000_student_leave_two_step`, which adds the enum value, the four columns and a foreign key. Applied to the local test DB. **NOT applied to Neon.**

**Tested:**
- New `tests/integration/student-leave-two-step.test.ts` (5 tests) covers:
  - teacher leave reaches the admin, shows in Needs action and gets a sidebar badge;
  - teacher approval → admin alert, Needs action and family alert, but not on the register;
  - admin final approval → on the register, with the audit trail;
  - teacher rejection overturned by the admin, with the teacher's decision kept;
  - an admin decision before the teacher;
  - the family cancelling while waiting;
  - school isolation.
- `library-photos-leave.test.ts` was updated for the two steps. The nav test was updated for the Leave entry.
- Full suite: 91 files, 932 tests passing.
- tsc, eslint and the build are clean.
- Screenshots of the admin Student leave page (1440px) and the parent Leave page (390px) were checked with a temporary fixture school, removed afterwards.

**Open:** Neon now has 11 pending migrations (`20261014…` to `20261023…`).

---

## 7 Oct 2026 — Simpler dashboards for parents and non-technical users

**Asked:**
- Check every dashboard so that parents and people with little technical knowledge can use them as easily as a phone.
- Make them simple and modern.
- List what is missing.

**Checked:** each role's dashboard (Parent, Student, Teacher, Staff/Accountant, Admin) was screenshotted at phone width (390px) and on desktop. Main problems found:
- Every dashboard opened with four large "school life" cards (Events, Leave, Notices, Meetings), usually showing **0**, which filled the phone screen.
- The parent page used technical words ("Written up", "Taken from today's records, not a separate list", "Drawn from what … recorded").
- Fees were not on the parent's home page.
- On phones the language switch was only a globe icon.
- The app could not be installed on a phone's home screen.

**Changed:**
- **School updates (every dashboard):** the four big cards became one short card with four rows: Notices, Events, Meetings, Leave.
  - Each row shows a count badge and the next item, or a one-line "nothing new".
  - The whole row can be tapped.
- **Parent dashboard,** rebuilt in the order a parent asks:
  1. **My children cards:** today's attendance in words ("Present today", "Absent today", "Today's attendance not marked yet"), attendance this year, and **Fees to pay** (or "Nothing due").
  2. **Needs your attention:** at most 5 tappable lines plus "See all", or a green "Nothing needs you today. All good!".
  3. **What do you want to see?** Eight big labelled buttons: Attendance, Homework, Results, Fees, Notices, Ask for leave, Talk to teacher, Meetings.
  4. The child's day, with plain labels: Classes today / Classes taught / Classes missed. The "help at home" card shows only when there is something in it.
  5. School updates.
- **Alert lists (parent, student, teacher, staff):** each line is tappable as a whole, instead of having a small "Open" button.
- **Student:** "For you" moved above the lists; School updates moved to the bottom.
- **Teacher:** removed the duplicated "no classes today" line.
- **Staff:** removed the "your workspace: …" jargon from the greeting.
- **Admin:** the side column uses the new School updates card.
- **Language button:** now shows "English" / "हिन्दी" on phones too.
- **Install on phone (PWA):**
  - New `app/manifest.ts`, home-screen icons in `public/` (192, 512, maskable, apple-touch) and a theme colour.
  - "Add to Home screen" now opens the app full-screen.
- **i18n:**
  - Hindi added for all new text.
  - Sample names in the student-import CSV template ("Aarav", "Sharma", "Rakesh") had been picked up as phrases, so names were being "translated". The extractor now honours an `i18n-ignore-file` marker, and those entries were removed.

**Migrations:** none.

**Tested:**
- Screenshots of the parent dashboard in English and Hindi, the student and staff dashboards at 390px, and the admin dashboard at 1440px, all against the local test DB with a temporary fixture school, removed afterwards.
- Full suite: 90 files, 927 tests passing.
- tsc, eslint and the build are clean.

**Missing — reported to the user, for their decision:**
- Mobile-number login with OTP (login is email + password only).
- SMS / WhatsApp messages to parents.
- Push notifications on the phone.
- Online fee payment.
- A "Call school / class teacher" button for parents.
- Password reset without email.

---

## 7 Oct 2026 — Unused code removed; admin sidebar and dashboard redesigned

**Asked:**
- Delete what is unnecessary or unused in the project, and list what was deleted.
- Make the admin dashboard more modern and easier to work from.
- Put the daily places in the sidebar: Students, Attendance, Parents, Teachers, Non-teaching staff, Finance/Accountant, Library, Communication, Security & Gate, Front Desk, Reports, Calendar, Timetable, Settings, Profile.

**Deleted** (found with `knip`, each checked by hand; nothing referenced them):

- **Files:**
  - `src/features/finance/overview.tsx` and `src/server/finance/overview.ts`, an old finance overview no page used, plus their test `tests/integration/finance-overview.test.ts`. `tenant-audit.test.ts` now checks the dashboard's `financeSnapshot` instead.
  - `src/features/auth/sign-out-button.tsx`.
  - `src/components/charts/attendance-colors.ts`.
  - Unused shadcn UI pieces: `components/ui/{badge,breadcrumb,pagination,select,separator,sidebar,tabs,tooltip}.tsx` and `hooks/use-mobile.ts`.
  - The Next.js template images: `public/{file,globe,next,vercel,window}.svg`.
  - `.DS_Store`.
- **Admin workspace hub pages:** `src/app/(app)/school-admin/areas/[area]` and `src/lib/admin-areas.ts`. The sidebar now links straight to each place.
- **Functions never called:**
  - `Meter`, `Sparkline` (charts), `useIntlLocale`, `TONE_BAR`.
  - `AcceptApplicationForm` and `acceptApplicationAction`. The server's `acceptApplication` stays: the API uses it.
  - `FeeDeskTodayPanel`, `idleResult`, `isStaffGrant`, `STREAM_RULE_HINT`, `linkExistingParentSchema`, `admissionsFunnel`, `accountState`, `assertFound`, `tokensMatch`, `deleteExpiredCodes`, `leaveLabel` (staff leave), `isTest`.
  - Their now-unused imports.
- **Kept on purpose:**
  - `scripts/*`: run by hand.
  - `prisma7.config.ts`: the Prisma CLI reads it.
  - `uploads/`: real files.
  - Migrations and docs.

**Changed:**

- **Admin sidebar.** One click to each daily place, in four labelled groups:
  - Dashboard.
  - **Daily work:** Students, Attendance, Parents, Teachers, Non-teaching staff.
  - **School office:** Finance & Accounts, Library, Communication, Gate & Security, Front Desk, Transport.
  - **Plan & review:** Reports, Calendar, Timetable, Classes & Exams.
  - **Account:** Settings, Profile.
  - Transport and Classes & Exams were added so no page lost its way in.
  - Each entry owns its related pages (for example Attendance also covers leave, and Teachers covers substitutes).
  - New tab rows:
    - Front Desk: Walk-in enquiries / Online applications / Admission drives.
    - Non-teaching staff: Staff / Role workspaces.
    - Students: Students / Needs attention / Concerns.
  - Sidebar items are denser, with icon chips and group headings (`NavItem.group`).
  - Phone bottom bar: Dashboard, Students, Attendance, Finance.
- **Admin dashboard:**
  - The welcome bar has "Today's attendance" and "Collect fee" buttons.
  - Below it: today's figures, then **Daily tasks** as one row of 8 buttons (Collect fee, Add student, Add enquiry, Send notice, Create test, New meeting, Add staff, Add expense).
  - **Two columns on wide screens:**
    - Main: Academics, Money, Students, Staff workspaces.
    - Right: **Needs action**, Staff today, Happening soon.
  - On phones, Needs action comes first.
  - Reusable options added: `QuickActions compact`, `NeedsAttention stacked`, `SchoolLifeCards narrow`.
- **Hindi:** new nav, tab and dashboard labels.

**Migrations:** none.

**Tested:**
- The nav test was rewritten for the new sidebar. It checks the order and the groups, and that exactly one entry is highlighted for 33 admin pages.
- Full suite: 90 files, 927 tests passing.
- tsc, eslint and the production build are clean.
- Screenshots of the dashboard were taken at 1440px and 390px against the local test DB using a temporary fixture school, which was removed afterwards.

**Open:** the 10 migrations from 6–7 Oct are still not on Neon.

---

## 7 Oct 2026 — Check: recording a cash fee

**Asked:** whether the accountant or admin can record cash fees received from a parent in Collect fees.

**Checked:**
- Yes, this already exists.
  - Staff use `/staff/fees`, which needs the "Collect fees" grant (in the Accountant's default).
  - The admin uses Finance → Record a payment.
- Steps:
  1. Search for and select the student.
  2. Fill in the "Record a payment" card. Method defaults to **Cash**; the date can't be in the future; the receipt number is suggested.
  3. Record payment.
- After recording, the green banner has View / Print receipt.
- The parent then gets the `fee-paid` dashboard alert.

**Changed:** nothing. **Migrations:** none.

---

## 7 Oct 2026 — Parents told when fees are received

**Asked:**
- Explain how a cash fee is recorded and how the accountant enters it, so a receipt can be given.
- A message should also reach the parent's dashboard: "you paid this much on this date".

**Already in place, explained to the user:**
- At Collect fees (`/staff/fees`, or the admin's Record a payment), the fee desk records the payment: find the student, enter the amount, choose Cash/UPI/…, pick the date, keep or change the receipt number, Save.
- The receipt is then ready to print or download.
- Parents could already see every receipt on the child's Fees page.

**Changed:**
- **New parent alert kind `fee-paid`**, built from `FeePayment` rows like every other alert (nothing new is stored).
  - For 14 days after a payment is recorded, the parent's dashboard and notification center show "₹X fees received for <child>".
  - The alert gives the payment date, the method, the receipt number and what is still to pay. It links to the child's Fees page, where the receipt can be downloaded.
  - A receipt voided later shows "Receipt N cancelled", with the reason (warning tone).
  - Family payments are covered too, since they are per-child `FeePayment` rows.
- `readStudentFees` payments now include `createdAt`.
- **Hindi:** 1 phrase and 5 templates.

**Migrations:** none.

**Tested:**
- `accountant-fee-charges.test.ts` now has 9 tests. They cover:
  - the parent sees the amount, date, method and receipt after the accountant collects;
  - a voided receipt reaches the parent with its reason;
  - another school's parent sees nothing.
- Full suite: 91 files, 945 tests passing.
- tsc, eslint and the build are clean.

**Open:**
- No SMS or WhatsApp. Email is not sent for payments either; it is a dashboard alert only.
- The 10 migrations from 6–7 Oct are still not on Neon.

---

## 7 Oct 2026 — Accountant adds fees and charges classes

**Asked:**
- When a family comes to pay a fee that was never charged, the accountant must be able to add it, so it shows up for collection.
- The class/section charging the admin does must be possible for a hired accountant too.
- The admin keeps all of it.

**Changed:**
- **Two new staff responsibilities**, both in the Accountant's default:
  - `fees.manage` — "Fee structure & charges": fee heads, charge a class or section or one student, remove a wrong charge, void a wrong receipt, carry forward old dues.
  - `fees.concessions` — "Give fee concessions".
  - Librarian, Security and Peon can never hold them.
- **Untouched accountants are upgraded automatically.** An accountant still on the previous default, never customised, picks these up through the existing `upgradeUntouchedGrants`. An accountant the admin limited by hand stays limited.
- **Server guards** moved from School Admin only to `assertAdminOrStaffPermission`, so the admin always passes:
  - `fees.manage`: `createFeeHead`, `setFeeHeadActive`, `chargeStudent`, `chargeSection`, `removeCharge`, `voidPayment`, `voidFamilyPayment`, carry forward.
  - `fees.concessions`: grant and withdraw.
  - The matching server actions now accept `NON_TEACHING_STAFF`.
  - `recordPayment`'s audit entry now carries the receipt number and amount.
- **Fee desk (`/staff/fees` and the admin's Record a payment).** The selected student now has a fees card with **"Add a fee for this student"**: pick a fee head, amount and due date. The new charge shows as pending and can be collected straight away. Wrong charges can be removed from the same card. This is the new `features/finance/student-charges.tsx`.
- **New page `/staff/fees/structure`.** The same screen as the admin's Fee collection page: fee heads, Charge a class, and who owes what.
  - Both pages now use the shared `features/finance/fee-structure-screen.tsx`.
  - Links to it from the Collect fees header, the staff Finance page and the Accounts desk on the staff dashboard.
- **Staff payment history** has a Void button for staff with `fees.manage`.
- **`StudentFeeAccount`** now gates concessions (`canConcession`) and carry forward (`canCarryForward`) separately.
- **Hindi:** 10 new phrases.

**Migrations:** none. Grants are strings on `StaffMember.grants`.

**Tested:**
- New `tests/integration/accountant-fee-charges.test.ts` (8 tests) covers:
  - fee head plus class charge;
  - a walk-in single-student charge that shows as pending and is collected;
  - remove charge, void receipt, concession;
  - an old-default accountant upgraded;
  - a hand-limited accountant refused;
  - the admin keeps all of it;
  - school isolation.
- Full suite: 91 files, 944 tests passing.
- tsc, eslint and the production build (against the test DB) are clean.

**Open:** the 10 migrations from 6–7 Oct are still not on Neon (see Current status).

---

## 7 Oct 2026 — The accountant runs the school's accounts (and the admin still can)

**Asked (Hindi):** when the admin hires a role, that role's responsibilities must go to the new person. The accountant's dashboard showed mostly "collect fees", but an accountant manages all of the school's accounts: add expenses, pay salaries, buy new gadgets, and so on. Until someone is hired the admin does it, and after hiring the admin can still do it — the admin's access is never removed.

**Reverses:** the 6 Oct decision that payroll is not an accountant default (made for that day's payroll request). The user's rule now is that the accountant's default responsibilities are the whole of the accounts.

**Done:**
- **Accountant default responsibilities:** fees (view, collect, reports), expenses (view, **add**, **remove**), payroll (**view**, **pay salaries**). Salary structures (what someone earns) stay with the School Admin. The admin keeps all of it regardless, as before.
- **Gadgets/purchases:** "Buy equipment / gadget" opens the expense form with the **Equipment & gadgets** category chosen (a computer, projector, lab item…).
- **Accounts desk** on the accountant's dashboard replaces the fee-only panel:
  - Figures: collected today, pending fees, spent this month, salaries still to pay this month.
  - Actions: Collect fee, Add expense, Buy equipment / gadget, Pay salaries, Accounts & reports.
  - Each part shows only with that responsibility, and the server checks again.
- **Existing accountants:**
  - A built-in role still on an old default moves to the new one.
  - **A staff member whose access was never customised** moves too, on their next sign-in or when the admin opens Staff. This is audited as "given the role's updated default responsibilities", with no person as actor.
  - **Anyone the admin set by hand is never widened.** A new `StaffMember.grantsCustomized` flag is set whenever the admin ticks permissions themselves, and cleared on "restore role defaults" / "apply to everyone in the role". The migration backfills it from the audit log for staff whose permissions an admin had already changed.

**Migrations (NOT on Neon):** `20261022090000_staff_grants_customized` (new column + backfill).
- **Effect on live data once applied:** the test login `accountant@schoolos.test` was created with defaults and never customised, so it will get the full accounts responsibilities on next sign-in.
- Accountants an admin had already edited keep exactly what they have.

**Tested:** new `tests/integration/accountant-accounts.test.ts` (5 tests). It covers:
- the accountant collecting, recording a gadget purchase, removing a wrong expense and paying salaries, but not setting salaries;
- the admin doing all of it too;
- an old-default accountant upgraded and audited, while a hand-limited one stays limited;
- school isolation.

Earlier tests were updated for the new default (staff-payroll, staff-role-dashboards, staff-management). Full suite is 90 files / 936 tests passing. `tsc`, `eslint`, phrase coverage and the production build (local test DB) pass. Not clicked through in a browser.

---

## 6 Oct 2026 — Admin workspaces, simpler navigation, and attendance that never submits itself

**Asked:** organise SchoolOS around one principle: the School Admin can run the whole school alone, and hiring staff delegates work without taking any of it away. Group the admin's screens into operational workspaces with a much shorter sidebar. Give each staff role its workspace and default responsibilities, which the admin can customise. Make sensitive corrections auditable with old → new values and a reason. **Critically:** student attendance must never be submitted automatically, only by the teacher's explicit Submit. Reuse what exists; do not add an ERP.

**Audit findings:**
- **Attendance auto-submitted** (violated the new rule). A school on the default AUTO setting had every draft register submitted when its period ended, by `finalizeDueRegisters`. It ran on **every page load** (the notification bell), when a register was opened or saved, from the cover/dashboard reads, and from a cron endpoint.
- Drafts themselves never reached parents or reports (only `StudentAttendance`, written on submit, is read anywhere), so dashboards were fine once auto-submission stopped.
- Admin authority was already intact: every staff check is "School Admin, or staff with the grant", so hiring never removed anything from the admin.
- The admin sidebar had 18 module entries.

**Done:**
- **Attendance — explicit Submit only:**
  - Removed `finalizeDueRegisters`, all of its call sites, and the cron route `/api/cron/attendance`.
  - Saving a draft never sets an automatic submission time.
  - The "submits automatically" setting is gone; Settings → Attendance now says attendance is final only on Submit Attendance.
  - Migration `20261021090000_attendance_explicit_submit`: schools set to MANUAL, the default is MANUAL, and waiting drafts lose any automatic time. Already-submitted registers are untouched.
  - **Register UI:** summary tiles (Present / Absent / Late / Half day / Leave / Not marked), **Save Draft**, **Submit Attendance**, and afterwards "✓ Attendance submitted by <name> · <time>". Old automatic submissions are labelled "automatically (before 6 Oct 2026)".
  - The teacher dashboard no longer says "submits itself at …".
- **Attendance corrections** are audited in words: "Rahul Sharma: Absent → Present … Reason: Parent confirmed attendance", with a per-student old → new table. The actor and role come from the audit log (e.g. School Admin).
- **Admin navigation:** 13 workspaces replace 18 module entries — Dashboard, Academic, Students & Parents, Front Desk (enquiries, applications, admission drives), Finance, People & Staff, Library, Transport, Gate & Security, Communication (notices, events, meetings, calendar, complaints), Operations (student and staff leave, cover), Reports (attendance reports, downloads, audit), Settings (incl. Website).
  - Multi-page workspaces open a hub of cards (`/school-admin/areas/[area]`, `lib/admin-areas.ts`) linking the existing pages.
  - Every page highlights exactly one workspace.
  - Nothing was deleted or duplicated.
  - The phone bottom bar uses the workspaces.
- **Role → workspace:** `STAFF_ROLE_WORKSPACE` maps Accountant → Finance, Receptionist/Office → Front Desk, Librarian → Library, Driver/Attendant → Transport (own route), Security → Gate & Security, Lab assistant → Lab & Inventory, Coordinator → Academic, Support staff → Support duties (no broad access), Other → As assigned.
  - Shown on the staff dashboard ("your workspace: …"), the wizard and the staff profile.
  - The wizard says "responsibilities"; the existing grants still enforce on the server, and the role default stays separate from per-person changes.

**Not done / remaining gaps:**
- Support-staff task lists, and Half Day for *staff* attendance.
- The admin can read homework but not create it (homework is set by the teaching teacher).
- Teacher and parent/student navigation were already workspace-shaped and are unchanged.
- **Can be removed:** the unused `CRON_SECRET` env var. The `attendanceSubmission` column stays only for history.

**Migrations (NOT on Neon):** `20261021090000_attendance_explicit_submit`. This one also updates data — schools become MANUAL and drafts lose their automatic times — so apply it before the code goes live.

**Tested:** new `tests/integration/admin-workspaces.test.ts` (8 tests). It covers:
- the admin reaching every workspace with no staff, and after hiring (even with the accountant stripped of all grants);
- Accountant/Receptionist/Security/Librarian workspaces and server enforcement; a custom responsibility added without changing the role;
- opening and saving a draft submits nothing and parents/students see nothing; Submit makes it visible;
- the admin's correction audited with name, old → new and reason; isolation.

`attendance-workflow` was rewritten from "auto-submits at period end" to "never submits by itself; only Submit". The nav tests were rewritten for the workspaces. Full suite is 89 files / 931 tests passing. `tsc`, `eslint`, phrase coverage and the production build (local test DB) pass. Not clicked through in a browser.

---

## 6 Oct 2026 — Staff management: creation wizard, permissions, documents, workspaces, audit

**Asked:** a complete staff management system: a multi-step creation wizard, role → default permissions → per-person overrides, documents, account activation, staff profile tabs, admin role workspaces without impersonation, and a proper audit log showing the real actor. The School Admin/MD stays the unrestricted authority of their own school, and tenants stay isolated. Inspect first, reuse what exists, and do not duplicate.

**Reused, not rebuilt:**
- `StaffMember`, which keeps employment and profile data separate from the `User` login; the separate `Teacher` model.
- Role profiles (`StaffRoleProfile.defaultGrants`) and the grant catalogue with server checks (`assertAdminOrStaffPermission`).
- Status/lifecycle (Active, Inactive, On leave, Suspended…, never deleted) and login enable/disable (`setLoginAccess`).
- Activation links: hashed, 7-day expiry, single use, no password ever emailed.
- `ProfilePhoto`, the private file store, and `AuditLog` plus the school audit page.
- The School Admin already passes every staff permission check by role, so no staff setting can reduce the admin.

**Added:**
- **Schema** (`20261020090000_staff_profiles_documents_audit`):
  - Staff: date of birth, gender, address, experience, employment type, emergency contact.
  - New `StaffDocument` (type, label, file, size, verification status, notes, uploaded by and when; archived, never deleted).
  - `AuditLog.actorRole` and `AuditLog.module`.
- **Audit foundation:**
  - `recordAudit` stores the actor's role at that moment ("School Admin", "Accountant"…) and the module, worked out from the action name. Every existing call site benefits without changes.
  - Fee payments now also carry the payment id and receipt in metadata.
  - Account activation now lands in the school's own log, which it did not before.
- **Wizard** (`/school-admin/staff/new`), 4 steps: personal & employment → role & permissions (role defaults ticked and editable; grants a role can never hold are shown disabled) → documents (optional) → review.
  - One submission. The staff record, role, grants, login (pending activation), salary and documents are written in **one transaction**. Files are checked first and stored before it, and removed again if it fails.
  - The activation email and photo follow after the commit.
  - Employee ID is automatic (STF-0001…) if left blank.
  - Teachers keep their own form, which the wizard links to. Academic Coordinator is offered under Teaching.
- **Permissions:**
  - The Role & access tab shows a summary: role defaults / custom added / custom removed / effective, with names.
  - **Restore role defaults** (with confirmation).
  - **Change role** with "Keep my custom changes" (new defaults + added − removed) or reset. Grants the new role can never hold are dropped and named.
  - Audit: `STAFF_PERMISSION_ADDED` / `STAFF_PERMISSION_REMOVED` / `STAFF_PERMISSIONS_RESET` / `STAFF_ROLE_CHANGED`.
  - The quick edit form no longer changes the role silently.
- **Documents tab:**
  - Upload PDF/JPG/PNG up to 10 MB, checked by content.
  - Set verification, and remove (archive; "Show removed").
  - Files are served only to the School Admin of the same school (`/api/v1/staff-documents/[id]/file`, private, no-store, sandboxed).
- **Profile edits:** all the new fields are editable. Each save records `STAFF_UPDATED` with every changed field as old → new. Fields not sent stay unchanged, so CSV imports and older API clients do not wipe them.
- **Audit:**
  - New staff **Audit log** tab: everything / changes to their record / done by them.
  - School audit page filters: person, role, module, action, date range, text.
  - Entries are human-readable, with an old → new table and raw details folded away.
  - Append-only: no edit or delete anywhere.
- **Workspaces** — not impersonation; the admin stays School Admin and is recorded as such:
  - Admin dashboard has a "Staff workspaces" section: Teaching (Teacher, Academic Coordinator) and Non-teaching (Accountant, Librarian, Receptionist, Transport/Driver, Support Staff, Other).
  - `/school-admin/staff/workspaces/[key]` lists the admin's own modules for that role and the people in it, with "Add …".
  - A school with only an MD and teachers can collect fees, issue books and so on from there without any staff accounts.

**Not built / limits:**
- No separate Role/Permission tables. The existing role profiles plus the grant catalogue do this; the catalogue covers the modules staff actually use (fees, payroll, expenses, library, inventory, transport, admissions, meetings, visitors, student directory). There are no staff grants for marks/exams, teacher management or school setup, because staff never reach those.
- Teaching staff are not created through the wizard (the teacher form is used).
- Documents are visible to the School Admin only, not to the staff member themselves.
- The UI was not checked in a browser (layout, dark mode, phone width).

**Migrations:** `20261020090000_staff_profiles_documents_audit` — NOT on Neon (local test DB only). No new environment variables: email uses the existing SMTP settings.

**Tested:** new `tests/integration/staff-management.test.ts` (14 tests). It covers:
- the admin collecting fees with no accountant, recorded as School Admin;
- the wizard creating everything, and a bad file leaving nothing behind;
- refused grants; only the admin may create staff;
- single-use activation, an expired link refused, and a disabled login refused;
- direct service calls refused without a grant while the admin is unaffected;
- the accountant's fee recorded as Accountant;
- role change keep/reset and restore defaults;
- the field-level old → new audit;
- private documents and archiving;
- audit filters, history after deactivation, and School B isolation.

Full suite is 88 files / 923 tests passing. `tsc`, `eslint`, phrase coverage and the production build (local test DB) pass.

---

## 6 Oct 2026 — Receptionist front desk, and visitor management for Security

**Asked:**

1. Audit the enquiry/follow-up system for the Receptionist. Allow only admin-granted actions: create, view and search enquiries; follow-ups and their status; application status; limited student/parent lookup; meetings if permitted. Never fees, payroll, marks, teacher management or school setup automatically. The backend must match the screens.
2. Check Security / visitor functionality. If missing, build a minimal visitor module: name, mobile, purpose, person to meet, entry/exit time, vehicle, status. Security sees only security information; the admin controls permissions. Audit entry/exit edits. No gate automation.

**Audit result (receptionist):**

- Already in place from the earlier 6 Oct work: enquiries (view, search, create, follow-up, status), applications (view, move along), and the basic student directory (+ guardian contact as its own grant). All are separate grants the admin ticks or unticks, and the services check them.
- There is no grant at all for marks/results, teacher management or school setup, so staff can never reach those.
- **Fees and payroll** are not receptionist defaults.
- **Gap fixed:** staff could not schedule meetings at all.

**Done:**

- **New grant "Schedule meetings"** (`meetings.schedule`, module "Meetings / PTM"). It is not a default for any role.
  - With it, staff see the school's meetings and schedule new ones at `/staff/meetings/manage`, using the same screens as the admin (moved into `features/communication/screens/`).
  - They change or cancel **only the meetings they scheduled**.
  - Deleting a meeting and extra classes from support records stay School Admin only.
  - The meeting service checks all of this.
- **Visitor management** (new `Visitor` model):
  - Fields: name, mobile, purpose, person to meet, vehicle (upper-cased), entry and exit time, status (Inside / Left / Turned away), notes.
  - Log in (blank time = now), mark out, correct a visit, and search by name, mobile, person or vehicle. A day view also lists anyone still inside from earlier.
  - Pages: `/staff/visitors`, `/school-admin/visitors` (a tab beside Transport). The staff dashboard has a "Gate" panel with visitors inside now and today.
  - New grants `visitors.view` / `visitors.manage` (module "Visitors & gate"). Security defaults to both, and an untouched empty Security role profile upgrades.
  - Rules: entry and exit cannot be in the future, and exit cannot be before entry.
  - Audit: `VISITOR_ENTERED`, `VISITOR_EXITED`, and `VISITOR_UPDATED` with each changed field old → new. Visits are never deleted.
  - Nothing in it reads students' studies, fees or marks.
- **Security can never hold** guardian contact, enquiries, applications, meeting scheduling or any finance grant.

**Migrations:** `20261019090000_visitors` — NOT applied to Neon (local test DB only).

**Tested:** new `tests/integration/receptionist-security.test.ts` (10 tests). It covers:
- the receptionist front desk by default, with no fees, payroll, meetings or visitors;
- meetings with the grant: own only, no delete;
- the Security profile upgrade, visitor in/out/search, future and before-entry refusals, the audited correction, turned away;
- Security's exclusions, view-only without manage, and school isolation.

Two older tests were updated: Security defaults, and the admin nav (Visitors folded under Transport). Full suite is 87 files / 909 tests passing. `tsc`, `eslint`, phrase coverage and the production build (local test DB) pass. Not clicked through in a browser.

---

## 6 Oct 2026 — Streams in timetable & homework, staff payroll, parent transport status, Half Day, Communication Center

**Asked (five requests in one message):**

1. Timetable and homework must respect streams (Class → Section → optional Stream → Subject → Teacher). Streams are never forced. Teachers, students and parents see only their own scope. Keep existing data, add conflict validation.
2. Payroll for non-teaching staff on the existing salary models, without breaking teacher payroll. Accountant gets payroll only when granted. Everything audited.
3. Parent-facing transport status (today's route, stop, pickup/drop with time) from the existing trip marks. Parents see only their own child. Drivers see only their own route. Audited.
4. Half Day attendance: admin can switch it off; counted in summaries and reports; no future dates; corrections audited.
5. A Communication Center over notices, events, meetings and notifications. Adds announcements and emergency alerts, audiences down to class, section or stream, keeps read/unread. No SMS/WhatsApp.

**Done:**

1. **Streams.**
   - `TimetableSlot.streamId` and `Homework.streamId` are new; null means the whole section, so all old rows are unchanged.
   - A stream can be chosen only for a section split into streams (`SectionStream`).
   - **Conflicts:**
     - Science and Commerce periods may run at the same time.
     - A whole-section period clashes with every stream's.
     - The same stream, the same teacher or the same room cannot be double-booked.
     - Checked under a section row lock. The section unique index now includes the stream.
   - Timetabling a stream period gives the teacher a stream assignment.
   - **Homework:**
     - A whole-section teacher may set work for the section or any of its streams.
     - A stream teacher may set work only for their own stream.
     - Homework set from a lesson takes the period's stream.
   - Students, parents, alerts and the student/parent APIs show whole-section items plus their own stream's only.
   - Timetables show the stream name.
2. **Staff payroll.**
   - `TeacherSalary` and `SalaryPayment` now name a teacher **or** a staff member. A database check enforces exactly one.
   - A staff profile has a new **Salary** tab: structure history, set or raise, payments.
   - Salaries and the monthly payroll list teachers and staff together, with each person's role and approved unpaid leave for both.
   - Mixed batch pay; nobody can be paid twice.
   - The payroll CSV has a "Staff type" column.
   - **Accountant default no longer includes `payroll.view`.** An untouched built-in profile upgrades; staff own grants are unchanged. Payroll needs "View payroll & salaries"; paying needs "Record salary payments"; the structure stays School Admin only.
   - Audit: `STAFF_SALARY_SET`, `SALARY_PAID`, `SALARY_PAYMENT_REMOVED`, and `PAYROLL_PAID` (totals only).
   - **Not built:** salary slip (none existed).
3. **Parent transport.**
   - New `childTransportToday` checks the guardian link itself. It shows route, stop, planned times, pickup/drop (Pending / Completed time / Not present / Issue) and today's crew (substitute named while covering).
   - Never other riders' data.
   - Shown on the parent's child page, plus `GET /api/v1/me/children/[id]/transport`.
   - `markTrip` writes a `TRANSPORT_TRIP_MARKED` audit entry, noting the old status on a correction. The School Admin can mark or correct any route; drivers only their own (or one they cover).
   - The old `childTransport` was replaced.
4. **Half Day.**
   - `AttendanceStatus.HALF_DAY` and `School.attendanceHalfDay` (default on) are new. The setting is a checkbox under Settings → Attendance, refused on the server when off.
   - One helper, `lib/attendance.ts`, counts a half day as 0.5 everywhere: shares, report cards, dashboards, charts, CSV.
   - Half Day is shown in the register, student/parent summaries, the section report and its export.
   - "Excused" is now labelled **Leave**.
   - The existing future-date block and correction audit apply.
   - **Not done:** Half Day for staff attendance.
5. **Communication Center** (`/school-admin/communication`, which replaces "Notices" in the admin sidebar):
   - Cards for Notices, Announcements, Events, Meetings/PTM and Notifications, plus an Emergency alerts panel with read counts.
   - `Notice.kind` (Notice / Announcement / Emergency) and scope **STREAM** are new.
   - Stream messages reach that stream's students and parents and the teachers of sections with that stream. Staff messages stay whole-school.
   - Emergency alerts go to the top of each recipient's notices and appear as **critical notifications** in the existing bell, with the existing read state.
   - Existing NoticeRead is unchanged. No SMS/WhatsApp.

**Migrations (all NOT on Neon):** `20261015090000_stream_timetable_homework`, `20261016090000_staff_payroll` (adds a payee check constraint), `20261017090000_attendance_half_day`, `20261018090000_communication_center`, `20261018100000_notice_stream_target` (updates the notice target check). Applied to the local test DB only.

**Tested:** new test files, all passing:
- `stream-timetable-homework` (9)
- `staff-payroll` (9)
- `parent-transport` (6)
- `attendance-half-day` (6)
- `communication-center` (6)

Updated tests: the transport test (new service), staff-role-dashboards (accountant payroll now granted, not default), the nav test (admin Communication entry), and tenant-audit (nullable teacher on payments). Full suite is 86 files / 899 tests passing. `tsc`, `eslint`, phrase coverage and the production build (local test DB) pass. None of it was clicked through in a browser.

---

## 6 Oct 2026 — Admission drives: teacher-run admissions with admin approval

**Asked:** extend the existing admissions (do not replace the online or walk-in workflow) so the School Admin can run an **admission drive** for a session: name, start/end, status (Scheduled, Active, Paused, Closed, Cancelled), and the classes or sections it covers. Each class/section gets a teacher with its own dates, capacity and permissions (view, create, edit, upload documents, submit). Final approval stays with the School Admin. Requirements:

- Teacher access ends when their end date passes.
- The admin can change the teacher, dates, capacity or permissions; pause, resume or extend; and reassign pending applications.
- Never delete history.
- Capacity is enforced on the server, and schools are isolated.
- Reuse the existing models, add audit logs, and run tests, typecheck and build.

**Done:**

- **Model** (reuses `AdmissionApplication`, sessions, classes, sections, teachers and students — no second application or student concept):
  - New `AdmissionDrive`: session, name, dates, status.
  - New `AdmissionAssignment`: class, optional section, teacher, the teacher's own dates, capacity, permissions, `pausedAt`, `removedAt`.
  - New `AdmissionDocument`: PDF, soft-removed.
  - `AdmissionApplication` gains `driveId`, `assignmentId`, `createdById`.
  - New status values `DRAFT` and `CORRECTION_REQUESTED`, and source `DRIVE`.
  - All three new tables are tenant-scoped (`TENANT_MODELS`).
- **Rules** (`src/lib/admission-drives.ts`, `src/server/admissions/drives.ts`):
  - A teacher can create, edit, upload or submit only when **all** of these hold: they have that permission; the drive is running (Scheduled/Active and inside its dates); the assignment is not paused or removed; and today is inside the **assignment's own** dates.
  - Write access therefore ends by itself when the end date passes. Viewing stays.
  - A teacher sees only their own assignments' applications.
  - Assignment dates must sit inside the drive's dates.
- **Workflow:**
  - Teacher: create (draft) → documents → submit → *Pending admin review*.
  - School Admin: Approve → the usual "Convert to student" opens, prefilled with the assignment's section. Or Reject (reason required), or Send back for correction (note required) → the teacher fixes it and resubmits.
  - Office staff with "Move applications along" **cannot** decide a drive application.
- **Capacity:**
  - Counted under a row lock. Every application except rejected ones takes a place.
  - Parallel clicks cannot overfill it.
  - Capacity cannot be set below the places already used.
- **Admin controls** on the drive page:
  - Assign a class/section to a teacher.
  - Change teacher, dates, capacity or permissions. A new teacher takes over the assignment and its applications; the old teacher's access ends.
  - Pause/resume, extend, remove (kept with `removedAt`).
  - Reassign pending applications to another assignment of the same class (target capacity checked; each one gets a history note).
  - Nothing is ever deleted.
- **Audit:** drive created/updated, assignment created/updated (with what changed, including the teacher)/paused/resumed/removed, applications reassigned, application created/edited/submitted/correction requested/rejected/approved, document added/removed.
- **Screens:**
  - Admin: new "Admission drives" tab under Admissions (`/school-admin/admissions/drives`, `/drives/[id]`). The application page shows the drive, teacher and documents, and an Approve / Correction / Reject card.
  - Teacher: "Admissions" appears in the sidebar only for a teacher with an assignment. Pages are `/teacher/admissions`, `/new`, `/[id]`, covering edit, documents and submit.
  - PDF documents are served at `/api/v1/admission-documents/[id]/file` (admin, office staff with applications view, or the assigned teacher).
  - Hindi added for all new text.
- Older office applications no longer include drive applications (`origin=office` now means walk-in, phone or office).

**Not done / choices:** approval cannot be delegated to a teacher. The request said approval stays with the School Admin "by default", and no per-assignment approve permission was added. Documents are PDF only (the existing document store). Paging a drive's application list beyond 500 is not needed yet.

**Migrations:** `20261014090000_admission_drives` (adds enum values, three tables, three nullable columns; no data changed). Applied to the local test database only — **NOT applied to Neon**. Run `npx prisma migrate deploy` against Neon after reviewing.

**Tested:** new `tests/integration/admission-drives.test.ts` (17 tests). Covers:
- admin-only setup; the full draft → submit → correction → resubmit → approve → admit flow;
- office staff refused; documents visible to the right people only;
- capacity, including 3 parallel creates for 1 place and the "not below used" rule;
- expiry by end date and by start date, extend, pause/resume, drive pause, per-permission refusals;
- change of teacher, reassign within capacity, remove without loss, audit entries, and school isolation.

Full suite: 81 files / 863 tests passing. `tsc`, `eslint`, phrase coverage and production build (local test DB) all pass. Not clicked through in a browser.

---

## 6 Oct 2026 — Role-specific staff dashboards: finance desk and front desk

**Asked:** the five test logins (accountant, receptionist, lab assistant, security, support) saw only a generic dashboard. Give each role its own dashboard and navigation through the **existing** grant system (no second permission system). The School Admin stays the final authority, per staff member. The server must enforce everything. Do not build a screen for a module that does not exist; report it instead. Do not modify existing users/data.

**Done:**

- **New grants** in the existing catalogue (`src/lib/staff-access.ts`), shown on the admin's permission checkboxes like every other grant. A new module, "Enquiries & admissions", has `enquiries.view`, `enquiries.manage`, `enquiries.fees`, `admissions.view` and `admissions.manage`. Under Fees there is `fees.reports`. Security and Support staff can never hold any finance grant, and a librarian can never hold `fees.reports`.
- **Role defaults** (only the starting point; the admin can still tick or untick anything per person). Accountant: fees view/collect, finance reports, expenses view/add, payroll view. Receptionist: enquiries view/manage, applications view/manage, student directory + contacts (no fee discussion by default). Lab assistant: inventory view/manage. Security / Support: none.
- **Role profiles.** A built-in role profile still on the old default (never edited by the admin) moves to the new default the next time the admin opens the staff pages. An edited one is left alone. **No staff member's own permissions are changed.**
- **Accountant:** new **Finance** dashboard at `/staff/finance`. It shows today's collection, this session's collected and pending fees, this month's spending, the salary bill, the largest outstanding fees, recent receipts (print/PDF) and CSV reports via `/staff/finance/export`. **Payment history** is at `/staff/fees/payments`. Each part shows only with its permission, and the services check again.
- **Receptionist:** **Enquiries** at `/staff/enquiries` (list, new, detail, edit, follow-ups, status, link parent, withdraw child) and **Applications** at `/staff/admissions` (list, detail, status, follow-ups). These are the same screens as the admin's, moved into shared components in `src/features/admissions/screens/` and scoped. Admitting a student, applying concessions, archiving and form settings stay School Admin only. Without `enquiries.fees`, a new enquiry is saved without fee figures, whatever the form sends. The staff dashboard has a "Front desk" panel with open enquiries, follow-ups due today and online applications in progress.
- **Server guards** changed from admin-only to admin-or-grant on: enquiry and application services; `listPayments`, `listSalaries`; the fee/payment/expense/salary export tables. Expense and salary exports need the report grant **and** that area's own grant.
- Sidebar: Finance, Enquiries and Applications entries, shown only with their grants. Hindi added for all new text.

**Not built (modules that do not exist; no placeholder screens were made):** a lab module (lab assistants get only Inventory), visitor / gate entry-exit for Security, and a task list for Support staff. Those three roles see the common staff pages: notices, meetings, calendar, leave, own attendance.

**Test logins on Neon were not changed** (as asked). Their own permissions are still the old defaults: accountant fees view/collect, receptionist student directory, lab assistant inventory view. So the receptionist will not see Enquiries until the admin gives it. To do that: School Admin → Staff → Roles → the role → Save with "also give the staff in this role these permissions", or tick the permissions on each person's profile.

**Migrations:** none.

**Tested:** new `tests/integration/staff-role-dashboards.test.ts` (14 tests). Covers receptionist enquiries and applications, fee stripping, no conversion, grants on/off, accountant finance, security and support never getting finance, profile upgrade only when untouched, and school isolation. Two older tests were updated because they pinned the old accountant default. Full suite is 80 files / 846 tests passing. `tsc`, `eslint` and the production build (against the local test DB) all pass. Phrase coverage passes.

---

## 5 Oct 2026 — Non-teaching staff test logins in Green Valley Academy (live)

**Asked:** create test logins for every non-teaching staff role in the existing Green Valley Academy, without changing any existing data; skip roles that already exist; password `SchoolOS@2026`.

**Done:** new `scripts/create-staff-test-accounts.ts` (dry run by default; `--apply` writes; `--school "<name>"`). It checks the required migration is applied, finds exactly one school by name, skips a role that already has a current staff member with an active login (or an email already in use), and otherwise creates an active, already-activated `NON_TEACHING_STAFF` user plus staff record with the school's built-in role profile and its default permissions. Nothing existing is updated or deleted. Tested on a local scratch database first (dry run, apply, re-run skips everything, password verifies).

Run against the live database (Neon):

| Name | Role | Email | Password | Status |
| --- | --- | --- | --- | --- |
| lavkush kush | Librarian | lavkush@gmail.com | (unchanged) | Already existed — skipped |
| alok kush | Driver | alok@gmail.com | (unchanged) | Already existed — skipped |
| Test Accountant | Accountant | accountant@schoolos.test | SchoolOS@2026 | Created |
| Test Receptionist | Receptionist | receptionist@schoolos.test | SchoolOS@2026 | Created |
| Test Lab Assistant | Lab assistant | labassistant@schoolos.test | SchoolOS@2026 | Created |
| Test Security | Security | security@schoolos.test | SchoolOS@2026 | Created |
| Test Support Staff | Support staff | support@schoolos.test | SchoolOS@2026 | Created |

Later the same day, at the user's request, the existing Librarian login `lavkush@gmail.com` had its password set to `SchoolOS@2026` (password only; nothing else on the account changed).

Each new record has employee ID `TEST-…`, job title "<Role> (test account)" and a note saying it is a test login; set them Inactive from Staff when no longer needed.

**Migrations:** none (data only).

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
