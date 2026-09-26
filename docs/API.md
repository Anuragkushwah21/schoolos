# SchoolOS REST API

Audience: developers integrating with SchoolOS — a mobile app, a reporting
script, an ERP or a website.

Base URL: `https://<your-deployment>/api/v1`. `GET /api/v1` returns the live
endpoint catalogue, so a client can always check what this deployment offers.

---

## 1. Authentication

Two ways in, and both resolve to *a person*:

**Bearer token** — for anything outside a browser.

```bash
curl https://schoolos.app/api/v1/me \
  -H "Authorization: Bearer sos_…"
```

**Session cookie** — for the app's own frontend, same-origin only.

A token is created by a School Admin (for their school) or a Super Admin (for
the platform) under **API tokens** in the sidebar. What matters about it:

* **A token acts as the person who created it.** It has no role of its own, so
  it can never do more than they could.
* **It dies with them.** Deactivate the owner, or suspend their school, and the
  token stops working on its very next request — the same rule as a session.
* **Only a hash is stored.** The token is shown once, at creation. If it is
  lost, revoke it and issue another.
* **`READ` tokens are refused on every write** (`POST`, `PUT`, `PATCH`,
  `DELETE`), so a token handed to a reporting script cannot change a record
  even if it leaks.
* Cookie-authenticated writes additionally require a same-origin `Origin`
  header. Token callers are exempt — a bearer token is not attached by a
  browser, so there is nothing to forge.

Every school's data is walled off from every other's, exactly as in the app: a
token for one school that asks for another's record is told the record does not
exist, never that it exists but is forbidden.

---

## 2. Shape of every response

Success:

```json
{ "data": { "…": "…" }, "meta": { "page": 1, "pageCount": 4, "total": 87 } }
```

`meta` appears on paginated lists and where a call has something to add
(the resolved academic session, how many rows were saved).

Failure:

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "Please correct the highlighted fields.",
    "fieldErrors": { "email": ["Enter a valid email address"] }
  }
}
```

| Code | HTTP | When |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No credentials, or a token that is unknown, revoked, expired or whose owner is gone |
| `FORBIDDEN` | 403 | Wrong role, a read-only token on a write, a teacher reaching past their own classes |
| `NOT_FOUND` | 404 | No such record **in your school** |
| `CONFLICT` | 409 | A duplicate, a full section, a clashing period, a decision already made |
| `VALIDATION` | 422 | The body or query failed validation; `fieldErrors` says where |
| `RATE_LIMITED` | 429 | Too many attempts from one address |
| `INTERNAL` | 500 | Something went wrong; the detail is in the server log, not the response |

Requests and responses are JSON. Bodies are validated with the same schemas the
web forms use, so the API and the UI cannot drift into disagreeing about what
is valid. Dates are `YYYY-MM-DD`; times of day are minutes from midnight
(`545` is 09:05); money is in paise.

When an id appears in both the path and the body, **the path wins**.

---

## 3. Your own data

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/me` | anyone signed in — who you are, and how you authenticated |
| `GET` | `/me/notices` | school roles — notices for your role, plus upcoming events |
| `GET` | `/me/timetable` | teacher, student — your own week |
| `GET` | `/me/attendance` | student — your own record |
| `GET` | `/me/children` | parent — your own children |
| `GET` | `/me/children/{studentId}` | parent — one child's attendance and timetable |
| `GET` | `/me/children/{studentId}/today` | parent — the register, each period as the teacher wrote it up, what is due, the latest mark and remark |
| `GET` | `/me/children/{studentId}/activity` | parent — what was actually taught. `?subject=` `?days=` |
| `GET` | `/me/children/{studentId}/homework` | parent — published work, bucketed: overdue, due today, due soon, later |
| `GET` | `/me/children/{studentId}/results` | parent — every assessment the class sat, with this child's mark. A null mark means they did not sit it, not zero |
| `GET` | `/me/children/{studentId}/remarks` | parent — structured teacher observations |
| `GET` | `/me/children/{studentId}/report` | parent — a summary assembled from source rows. `?period=day\|week\|month` |
| `GET` | `/me/alerts` | parent — derived on each read from real rows; there is no notification table |
| `GET` | `/me/focus` | parent — what to help with at home. `?child=<studentId>` required |

Every `/me/children/{studentId}` route resolves the child through the
`ParentStudent` link before reading anything. Another guardian's child, another
school's child and a made-up id all answer `404`, so changing the id in the path
reveals nothing. All of them are reads: the parent portal writes nothing.

A guardian asking for a child not linked to them gets a 404: the link is
checked in the database, and being in the same school is not enough.

---

## 4. School data

All of these are School Admin unless noted. They act on the caller's own
school; there is no school id to pass, and no way to name another one.

### People

| Method | Path | Notes |
| --- | --- | --- |
| `GET` `POST` | `/students` | `?q=&section=&class=&status=&page=` |
| `GET` `PUT` `DELETE` | `/students/{id}`. `DELETE` erases a student admitted by mistake and answers 409 once they have a register, a remark or a result — set `status` instead |
| `POST` | `/students/{id}/enrollments` | Place or promote; a later session keeps this year's record |
| `POST` `DELETE` | `/students/{id}/guardians`, `/students/{id}/guardians/{linkId}` | |
| `POST` | `/students/{id}/portal-access` | Issues a login; password returned once |
| `GET` | `/guardians` | `?q=` |
| `PUT` | `/guardians/{id}` | |
| `POST` | `/guardians/{id}/portal-access` | |
| `GET` `POST` | `/teachers` | Creating also creates their login |
| `GET` `PUT` `DELETE` | `/teachers/{id}` | `PUT` carries `email` and moves the sign-in address with it; `status: "INACTIVE"` also disables their login. `DELETE` erases the staff record and its login together and answers 409 once they have any record in the school — deactivate those instead |
| `POST` `DELETE` | `/teachers/{id}/assignments`, `/teachers/{id}/assignments/{assignmentId}` | An assignment is what lets a teacher mark that section's register |

### Academics

`GET` is open to teachers as well; writing is admin-only.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` `POST` | `/academic-sessions` | Overlapping dates are refused |
| `POST` | `/academic-sessions/{id}/activate` | Exactly one session is current |
| `GET` `POST` | `/classes`, `/streams`, `/subjects` | |
| `PATCH` | `/classes/{id}`, `/streams/{id}`, `/subjects/{id}` | `{ "isActive": false }` |
| `GET` `POST` | `/sections` | `?session=` — defaults to the current one |
| `GET` `PUT` `DELETE` | `/sections/{id}` | Only an empty section can be deleted |

### Timetable and attendance

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/timetable?section=` or `?teacher=` | admin, teacher | Teachers may only ask for their own sections |
| `POST` | `/timetable` | admin | Clashes for the section or the teacher are refused |
| `DELETE` | `/timetable/{slotId}` | admin | |
| `GET` `POST` | `/attendance?section=&date=` | admin, teacher | Today unless a date is given |
| `GET` `POST` | `/attendance/staff?date=` | admin | |
| `GET` | `/reports/attendance?section=&from=&to=` | admin, teacher | Without `section`, the whole school (admin only) |

Marking a register:

```bash
curl -X POST https://schoolos.app/api/v1/attendance \
  -H "Authorization: Bearer sos_…" \
  -H "Content-Type: application/json" \
  -d '{
    "sectionId": "ckv…",
    "date": "2026-09-21",
    "entries": [
      { "studentId": "ckw…", "status": "PRESENT" },
      { "studentId": "ckx…", "status": "ABSENT", "remarks": "Fever" }
    ]
  }'
```

Rules the server keeps, whatever the client does: no future dates; the date
must fall inside the section's academic session; teachers may mark the last
seven days only, while an admin may correct any day in the session; and every
student in `entries` must be enrolled in that section — one that is not fails
the whole save rather than being quietly skipped.

### Communication, admissions, website

| Method | Path | Notes |
| --- | --- | --- |
| `GET` `POST` | `/notices` | `?status=` — includes drafts |
| `GET` `PUT` `DELETE` | `/notices/{id}` | Archive rather than delete to keep a record |
| `GET` `POST` | `/events` | |
| `GET` `PUT` `DELETE` | `/events/{id}` | |
| `GET` | `/admissions` | `?status=` |
| `GET` | `/admissions/{id}` | |
| `POST` | `/admissions/{id}/status` | Under review, waitlisted or rejected |
| `POST` | `/admissions/{id}/accept` | Creates student, guardian and enrollment in one transaction |
| `GET` `PUT` | `/website/profile` | |
| `GET` `POST` | `/website/pages` | |
| `GET` `PUT` `DELETE` | `/website/pages/{id}` | |
| `GET` `POST` | `/website/media` | Gallery photos are `https://` links |
| `DELETE` | `/website/media/{id}` | |

Page and notice bodies are plain text with a small Markdown subset
(`#` headings, `-` lists, `**bold**`, `[link](https://…)`). They are rendered
as React elements and never as HTML, so markup in them is shown, not executed.

### Tokens

| Method | Path | Who |
| --- | --- | --- |
| `GET` `POST` | `/tokens` | School Admin, Super Admin |
| `DELETE` | `/tokens/{id}` | School Admin, Super Admin |

---

## 5. Platform (Super Admin)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/super-admin/schools` | `?status=&q=&page=`; `status=REVIEW` is the queue |
| `GET` | `/super-admin/schools/{id}` | Governance data and counts — never a school's records |
| `POST` | `/super-admin/schools/{id}/transition` | `{ "transition": "approve" }`, or `reject`/`suspend` with a `reason` |
| `GET` `POST` | `/super-admin/schools/{id}/admins` | |
| `PUT` | `/super-admin/schools/{id}/subscription` | |
| `POST` | `/super-admin/admins/{userId}/password` | New one-time password; signs them out everywhere |
| `POST` | `/super-admin/admins/{userId}/active` | `{ "isActive": false }` signs them out at once |
| `GET` | `/super-admin/plans`, `PUT /super-admin/plans/{id}` | Prices in rupees on the way in |
| `GET` `POST` | `/super-admin/offers` | |
| `GET` `PUT` `DELETE` | `/super-admin/offers/{id}` | |
| `GET` | `/super-admin/audit` | `?action=&schoolId=&q=&page=` |

Approving a school also provisions it — classes Nursery to 12, streams,
subjects and the current session. The administrator's account already exists
with the password chosen at registration, so nothing is generated; `credentials`
comes back non-null only when the school had no administrator and one was
created here, and that password is never retrievable again.

---

## 6. Public endpoints

No authentication, and no private data behind them. Only ACTIVE schools exist
here: a pending, rejected or suspended school is a 404.

| Method | Path |
| --- | --- |
| `GET` | `/public/schools/{slug}` |
| `GET` | `/public/schools/{slug}/pages/{pageSlug}` |
| `GET` | `/public/schools/{slug}/notices` |
| `GET` | `/public/schools/{slug}/events` |
| `GET` | `/public/schools/{slug}/admission-options` |
| `POST` | `/public/schools/{slug}/applications` |
| `POST` | `/public/registrations` |
| `POST` | `/public/registrations/{reference}/verify` |
| `POST` | `/public/registrations/{reference}/resend` |

The application and registration `POST`s are rate-limited per address and carry
a honeypot field (`website`) which must be absent or empty. An application
creates nothing in the school's records until an administrator accepts it, and
a registration creates a PENDING school and a dormant administrator account
that cannot sign in until the school is approved.

Registration takes `password` and `confirmPassword` alongside the school and
contact details — the administrator chooses their own, so no secret has to be
emailed later. It then emails a six-digit code to the contact address and
returns the reference to verify against:

```bash
curl -X POST https://schoolos.app/api/v1/public/registrations/abc-public-school/verify \
  -H "Content-Type: application/json" \
  -d '{ "code": "123456" }'
```

Until that succeeds the school cannot be approved. The code expires in ten
minutes, dies after five wrong guesses, and resending is throttled — a wrong
code, an expired one and an unknown reference all answer the same way.

---

## 7. Notes for clients

* **Pagination** is `?page=`; read `meta.pageCount` and `meta.total`. Page
  sizes are fixed per resource (25 for people, 20 for schools, 50 for audit).
* **Caching**: every authenticated response is `private, no-store`. Do not
  cache them in a shared cache.
* **Rate limits** are per address and per process. Treat a 429 as "retry
  later", using `Retry-After` when present.
* **Ids** are opaque strings. Do not parse them, and do not assume ordering.
* **Versioning**: breaking changes will appear under a new prefix (`/api/v2`).
  New fields may be added to responses at any time, so ignore what you do not
  recognise.
