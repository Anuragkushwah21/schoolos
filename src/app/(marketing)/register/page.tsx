import type { Metadata } from "next";

import { RegistrationExperience } from "@/features/platform/registration-experience";
import { getPublicPlans } from "@/server/platform/marketing";

export const metadata: Metadata = {
  title: "Register your school",
  description: "Compare SchoolOS plans and apply to bring your school onto SchoolOS.",
};

/** Plans are live rows the Super Admin publishes, so this page is never baked at build time. */
export const dynamic = "force-dynamic";

const NEXT_STEPS = [
  "Verify your email with the six-digit code we send you.",
  "We review the registration and the plan you chose, usually within two working days.",
  "Once approved, sign in with the password you choose here — your school is already set up with classes and the current session.",
];

export default async function RegisterPage(props: PageProps<"/register">) {
  const { plan } = await props.searchParams;
  // A plan that cannot be read must not stop a school registering.
  const plans = await getPublicPlans().catch((error: unknown) => {
    console.error("[register] could not read plans", error);
    return [];
  });
  const requested = typeof plan === "string" ? plan.toLowerCase() : "";
  const initialPlan = plans.find((row) => row.slug === requested)?.slug ?? "";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-14 sm:px-6 lg:py-20">
      <div className="flex max-w-3xl flex-col gap-3">
        <p className="text-primary text-sm font-semibold tracking-wide uppercase">Register your school</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Bring your school onto SchoolOS</h1>
        <p className="text-muted-foreground text-lg">Compare the plans, choose one (or decide later), and tell us about your school. There is nothing to pay today.</p>
        <ol className="text-muted-foreground mt-2 grid gap-2 text-sm sm:grid-cols-3">
          {NEXT_STEPS.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </div>
      <RegistrationExperience plans={plans} initialPlan={initialPlan} />
    </main>
  );
}
