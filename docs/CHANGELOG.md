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

_Last updated: 1 Oct 2026 (Events, Calendar, Notices, Meetings and Leave separated)_

| | |
| --- | --- |
| Database migrations | 31 in `prisma/migrations`. 29 applied to Neon; **`20261006090000_rooms` and `20261007090000_notice_reads` are NOT applied to Neon yet** — run `npx prisma migrate deploy` (one command applies both). Until then the Rooms, Timetable and Notices pages error on the live database |
| Tests | 62 files, 718 tests passing; lint clean; production build passing |
| Email | Code sends through Gmail SMTP when configured. **The Gmail App Password in `.env` was rejected by Gmail** — create a new App Password and put it in `SMTP_PASSWORD` |
| Uncommitted work | Everything since commit `d1118c8` (29 Sep) is not committed yet |

**Setup gaps on the live database** (not code bugs — features look broken until these are filled in):

- **Sankeswar** — all 7 sections have **no class teacher**; **0 subjects** assigned to teachers; no students yet. Without these, attendance registers have no owner, leave requests only the admin can approve, and every concern goes to the School Admin.
- **Green Valley Academy** — 9 of 13 sections have no class teacher.

**Known limits:** leave pages' body text is English only (menus are Hindi/English); timetable and homework are not split by stream (only concerns and support are); Class 6–8 leave uses the same rules as other classes but has no separate test.

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
