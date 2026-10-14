import type { Metadata } from "next";
import { BriefcaseIcon, CalendarDaysIcon, FingerprintIcon, GraduationCapIcon, HistoryIcon, KeyRoundIcon, SparklesIcon, UserRoundIcon } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { DocumentShortcuts, PersonDocuments } from "@/features/documents/person-documents";
import { HeroAction, MetricTile, Panel, ProfileHero, SoftRow, TileChip } from "@/features/people/profile-ui";
import { PrincipalProfileForm } from "@/features/principal/forms";
import { formatDate, formatDateTime, toDateInput, today } from "@/lib/dates";
import { fullName, pluralize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { getPrincipal } from "@/server/people/principals";
import { photoUrlFor } from "@/server/people/photos";

export const metadata: Metadata = { title: "Principal" };

/** Whole years and months between two dates: "6 yrs 1 mo". */
function tenure(from: Date, to: Date) {
  const months = Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() - (to.getDate() < from.getDate() ? 1 : 0));
  const years = Math.floor(months / 12);
  return [years ? pluralize(years, "yr") : null, months % 12 || !years ? pluralize(months % 12, "mo") : null].filter(Boolean).join(" ");
}

/**
 * The Principal's profile, for the School Admin: their login, their
 * employment record (employee ID, appointment and joining dates,
 * qualifications, experience) and their documents — ID card and employment
 * letters, which only the School Admin makes.
 */
export default async function PrincipalProfilePage(props: PageProps<"/school-admin/principal/[userId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { userId } = await props.params;
  const { user, profile } = await orNotFound(getPrincipal(ctx, userId));
  const photoUrl = await photoUrlFor(ctx, { type: "USER", id: user.id });
  const name = fullName(user);
  const now = today();
  const left = Boolean(profile?.exitDate && profile.exitDate <= now) || !user.isActive;
  const status = left ? "INACTIVE" : "ACTIVE";
  const history = [
    profile?.appointmentDate ? { date: profile.appointmentDate, text: `Appointed ${profile.designation}` } : null,
    profile?.joiningDate ? { date: profile.joiningDate, text: "Joined the school" } : null,
    { date: user.createdAt, text: "SchoolOS login created" },
    profile?.exitDate ? { date: profile.exitDate, text: "Last working day" } : null,
  ]
    .filter((row): row is { date: Date; text: string } => row !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <>
      <ProfileHero
        back={{ href: "/school-admin/principal", label: "Principal" }}
        name={name}
        photoUrl={photoUrl}
        presence={left ? "neutral" : "positive"}
        badge={<StatusBadge status={status} label={left ? "Former" : "Active"} />}
        role={profile?.designation ?? "Principal"}
        lines={[[user.email, user.phone].filter(Boolean).join(" · ")]}
        chips={[
          profile?.employeeId ? { label: `EMP ID: ${profile.employeeId}`, tone: "neutral", icon: FingerprintIcon } : { label: "Employee ID not set", tone: "amber" },
          profile?.joiningDate ? { label: `Joined ${formatDate(profile.joiningDate)}`, tone: "neutral", icon: CalendarDaysIcon } : null,
          profile?.qualification ? { label: profile.qualification, tone: "purple", icon: GraduationCapIcon } : null,
        ]}
        actions={
          <>
            <HeroAction href="#documents" icon={SparklesIcon} label="Generate document" primary />
            <HeroAction href="#employment" icon={BriefcaseIcon} label="Employment record" />
            <HeroAction href="/school-admin/settings/principal" icon={KeyRoundIcon} label="Login" />
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile label="Appointed" icon={BriefcaseIcon} tone="purple" value={profile?.appointmentDate ? formatDate(profile.appointmentDate) : "—"} valueClassName="text-xl" sub={profile?.appointmentDate ? "Date of appointment" : "Not recorded"} />
          <MetricTile label="Joined" icon={CalendarDaysIcon} tone="blue" value={profile?.joiningDate ? formatDate(profile.joiningDate) : "—"} valueClassName="text-xl" sub={profile?.joiningDate ? "Date of joining" : "Not recorded"} />
          <MetricTile label="Service" icon={HistoryIcon} tone="green" value={profile?.joiningDate ? tenure(profile.joiningDate, profile.exitDate && profile.exitDate < now ? profile.exitDate : now) : "—"} valueClassName="text-xl" sub={profile?.experience ?? "Experience not recorded"} />
          <MetricTile
            label="Login"
            icon={KeyRoundIcon}
            tone="cyan"
            value={!user.isActive ? "Closed" : user.activatedAt ? "Active" : "Pending"}
            valueClassName="text-xl"
            sub={user.lastLoginAt ? `Last sign-in ${formatDateTime(user.lastLoginAt)}` : "Not signed in yet"}
          />
        </div>

        {profile ? (
          <DocumentShortcuts ctx={ctx} kind="PRINCIPAL" personId={profile.id} picks={["STAFF_ID_CARD", "APPOINTMENT_LETTER", "EMPLOYMENT_VERIFICATION"]} more="#documents" />
        ) : null}

        <div className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
          <Panel id="employment" title="Employment record" icon={UserRoundIcon} description="What the Principal's ID card and letters print. Only you can change it.">
            <PrincipalProfileForm
              userId={user.id}
              values={{
                employeeId: profile?.employeeId ?? "",
                designation: profile?.designation ?? "Principal",
                qualification: profile?.qualification ?? "",
                experience: profile?.experience ?? "",
                appointmentDate: profile?.appointmentDate ? toDateInput(profile.appointmentDate) : "",
                joiningDate: profile?.joiningDate ? toDateInput(profile.joiningDate) : "",
                exitDate: profile?.exitDate ? toDateInput(profile.exitDate) : "",
                dateOfBirth: profile?.dateOfBirth ? toDateInput(profile.dateOfBirth) : "",
                addressLine: profile?.addressLine ?? "",
                city: profile?.city ?? "",
                state: profile?.state ?? "",
                postalCode: profile?.postalCode ?? "",
              }}
            />
          </Panel>
          <Panel title="Employment history" icon={HistoryIcon} tone="purple" description="From the dates on this record.">
            <ul className="flex flex-col gap-2">
              {history.map((row) => (
                <SoftRow key={row.text}>
                  <TileChip tone="neutral">{formatDate(row.date)}</TileChip>
                  <span className="text-sm font-medium">{row.text}</span>
                </SoftRow>
              ))}
            </ul>
          </Panel>
        </div>

        {profile ? (
          <PersonDocuments ctx={ctx} kind="PRINCIPAL" personId={profile.id} />
        ) : (
          <Panel id="documents" title="Documents" icon={SparklesIcon} description="Save the employment record first — the ID card and letters are made from it.">
            <p className="text-muted-foreground text-sm">Nothing to make yet.</p>
          </Panel>
        )}
      </div>
    </>
  );
}
