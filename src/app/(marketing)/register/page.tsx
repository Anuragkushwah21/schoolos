import type { Metadata } from "next";
import { CheckIcon } from "lucide-react";

import { RegisterForm } from "@/features/platform/register-form";
import { formatMoney } from "@/lib/format";
import { PLAN_TIERS } from "@/lib/validation/platform";
import { getPublicPlans } from "@/server/platform/marketing";

export const metadata: Metadata = {
  title: "Register your school",
  description: "Apply to bring your school onto SchoolOS.",
};

const NEXT_STEPS = [
  "Verify your email with the six-digit code we send you.",
  "We review the registration, usually within two working days.",
  "Once approved, sign in with the password you choose here — your school is already set up with classes Nursery to 12 and the current session.",
];

export default async function RegisterPage(props: PageProps<"/register">) {
  const { plan } = await props.searchParams;
  const plans = await getPublicPlans();

  const requested = typeof plan === "string" ? plan.toUpperCase() : undefined;
  const defaultPlan = PLAN_TIERS.find((tier) => tier === requested);

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:py-20">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-primary text-sm font-semibold tracking-wide uppercase">
            Register your school
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Bring your school onto SchoolOS
          </h1>
          <p className="text-muted-foreground text-lg">
            Tell us about your school and who we should contact. There is
            nothing to pay today.
          </p>
        </div>

        <div className="bg-muted/50 rounded-2xl border p-6">
          <h2 className="font-semibold">What happens next</h2>
          <ol className="mt-4 flex flex-col gap-4 text-sm">
            {NEXT_STEPS.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {index + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
          {["Every module on every plan", "Your data is private to your school", "Change plan any time"].map(
            (point) => (
              <li key={point} className="flex items-center gap-2">
                <CheckIcon className="text-primary size-4" aria-hidden />
                {point}
              </li>
            ),
          )}
        </ul>
      </div>

      <div className="bg-card ring-foreground/10 relative rounded-2xl p-6 shadow-sm ring-1 sm:p-8">
        <RegisterForm
          plans={plans.map((p) => ({
            value: p.tier,
            label: `${p.name} — ${formatMoney(p.priceMinor, p.currency)} / year`,
          }))}
          defaultPlan={defaultPlan}
        />
      </div>
    </main>
  );
}
