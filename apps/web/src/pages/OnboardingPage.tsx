import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserSettings } from "@/hooks/useUserSettings";
import {
  CONTENT_TYPE_OPTIONS,
  DEVICE_TYPE_OPTIONS,
  EXTERNAL_PLAYER_OPTIONS,
  ISP_WARNING_TEXT,
  ONBOARDING_STEPS,
  type OnboardingFormValues,
  type OnboardingStepId,
  toggleContentType,
  validateOnboardingStep,
  validateOnboardingValues,
  VIRUS_WARNING_TEXT,
} from "@/lib/settingsForm";
import type { DeviceType, ExternalPlayer } from "@/lib/userSettings";
import { cn } from "@/lib/utils";
import "./onboarding.css";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { settings, saveSettings } = useUserSettings();
  const [stepIndex, setStepIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      deviceType: settings.deviceType ?? "",
      contentTypes: settings.contentTypes ?? [],
      realDebridApiKey: settings.realDebridApiKey ?? "",
      externalPlayer: settings.externalPlayer ?? "",
      letterboxdUsername: settings.letterboxdUsername ?? "",
      virusWarningAccepted: settings.virusWarningAccepted === true,
      ispWarningAccepted: settings.ispWarningAccepted === true,
    } satisfies OnboardingFormValues,
    onSubmit: async ({ value }) => {
      const error = validateOnboardingValues(value);
      if (error) {
        setStepError(error);
        return;
      }

      saveSettings({
        deviceType: value.deviceType as DeviceType,
        contentTypes: value.contentTypes,
        realDebridApiKey: value.realDebridApiKey.trim(),
        externalPlayer: value.externalPlayer as ExternalPlayer,
        letterboxdUsername: value.letterboxdUsername.trim() || undefined,
        virusWarningAccepted: true,
        ispWarningAccepted: true,
        onboardingCompleted: true,
      });
      void navigate("/", { replace: true });
    },
  });

  const step = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === ONBOARDING_STEPS.length - 1;
  const questionNumber = stepIndex;
  const questionTotal = ONBOARDING_STEPS.length - 1;

  function goBack() {
    setStepError(null);
    setStepIndex((current) => Math.max(0, current - 1));
  }

  function goNext() {
    const values = form.state.values;
    const error = validateOnboardingStep(step.id, values);
    if (error) {
      setStepError(error);
      return;
    }
    setStepError(null);

    if (isLast) {
      void form.handleSubmit();
      return;
    }
    setStepIndex((current) => Math.min(ONBOARDING_STEPS.length - 1, current + 1));
  }

  return (
    <div className="onboarding-shell min-h-screen bg-zinc-950 text-white">
      <main className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-8 md:px-8 md:py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <p className="text-sm font-medium uppercase tracking-wide text-red-500">JedFlix</p>
          {!isFirst ? (
            <p className="text-xs text-zinc-500">
              Step {questionNumber} of {questionTotal}
            </p>
          ) : null}
        </div>

        {!isFirst ? (
          <div className="mb-8 flex gap-1.5" aria-hidden>
            {ONBOARDING_STEPS.slice(1).map((item, index) => (
              <span
                key={item.id}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  index < stepIndex ? "bg-red-500" : "bg-zinc-800",
                )}
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-1 flex-col">
          <div key={step.id} className="onboarding-step-enter flex flex-1 flex-col">
            {step.id === "welcome" ? (
              <WelcomeStep />
            ) : (
              <>
                <h1 className="text-3xl font-bold tracking-tight">{step.title}</h1>
                <p className="mt-2 text-zinc-400">{step.description}</p>
                <div className="mt-8">
                  <StepFields stepId={step.id} form={form} />
                </div>
              </>
            )}
          </div>

          {stepError ? <p className="mt-4 text-sm text-red-400">{stepError}</p> : null}

          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-zinc-800 pt-6">
                <Button
                  type="button"
                  variant="outline"
                  className="border-zinc-700 bg-transparent"
                  disabled={isFirst || isSubmitting}
                  onClick={goBack}
                >
                  Back
                </Button>
                <Button type="button" disabled={isSubmitting} onClick={goNext}>
                  {isSubmitting
                    ? "Saving..."
                    : isFirst
                      ? "Get started"
                      : isLast
                        ? "Finish"
                        : "Continue"}
                </Button>
              </div>
            )}
          </form.Subscribe>
        </div>
      </main>
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="onboarding-hero relative mb-10 h-44 w-full max-w-sm" aria-hidden>
        <div className="onboarding-poster onboarding-poster-left" />
        <div className="onboarding-poster onboarding-poster-right" />
        <div className="onboarding-poster onboarding-poster-center">
          <span className="onboarding-play" />
        </div>
        <div className="onboarding-spark onboarding-spark-a" />
        <div className="onboarding-spark onboarding-spark-b" />
        <div className="onboarding-spark onboarding-spark-c" />
      </div>
      <p className="onboarding-brand text-5xl font-black tracking-tight text-red-600 md:text-6xl">
        JedFlix
      </p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight md:text-3xl">Your personal cinema</h1>
      <p className="mt-3 max-w-md text-zinc-400">
        Set up streaming preferences in under a minute. Direct Real Debrid playback, your way.
      </p>
    </div>
  );
}

function StepFields({
  stepId,
  form,
}: {
  stepId: OnboardingStepId;
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
}) {
  switch (stepId) {
    case "deviceType":
      return (
        <form.Field name="deviceType">
          {(field) => (
            <div className="grid gap-3">
              {DEVICE_TYPE_OPTIONS.map((option) => (
                <ChoiceButton
                  key={option.value}
                  selected={field.state.value === option.value}
                  label={option.label}
                  onClick={() => field.handleChange(option.value)}
                />
              ))}
            </div>
          )}
        </form.Field>
      );
    case "contentTypes":
      return (
        <form.Field name="contentTypes">
          {(field) => (
            <div className="space-y-3">
              {CONTENT_TYPE_OPTIONS.map((option) => {
                const checked = field.state.value.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border px-4 py-4 text-sm transition",
                      checked
                        ? "border-red-500 bg-red-500/10 text-white"
                        : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-red-500"
                      checked={checked}
                      onChange={(event) =>
                        field.handleChange(
                          toggleContentType(field.state.value, option.value, event.target.checked),
                        )
                      }
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          )}
        </form.Field>
      );
    case "realDebridApiKey":
      return (
        <form.Field name="realDebridApiKey">
          {(field) => (
            <Input
              id={field.name}
              type="password"
              autoComplete="off"
              autoFocus
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="Paste your Real Debrid API key"
              className="border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-600"
            />
          )}
        </form.Field>
      );
    case "externalPlayer":
      return (
        <form.Field name="externalPlayer">
          {(field) => (
            <div className="grid gap-3">
              {EXTERNAL_PLAYER_OPTIONS.map((option) => (
                <ChoiceButton
                  key={option.value}
                  selected={field.state.value === option.value}
                  label={option.label}
                  onClick={() => field.handleChange(option.value)}
                />
              ))}
            </div>
          )}
        </form.Field>
      );
    case "letterboxdUsername":
      return (
        <form.Field name="letterboxdUsername">
          {(field) => (
            <Input
              id={field.name}
              type="text"
              autoComplete="username"
              autoFocus
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="your-username"
              className="border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-600"
            />
          )}
        </form.Field>
      );
    case "virusWarning":
      return (
        <form.Field name="virusWarningAccepted">
          {(field) => (
            <AcknowledgementCard
              checked={field.state.value}
              text={VIRUS_WARNING_TEXT}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
      );
    case "ispWarning":
      return (
        <form.Field name="ispWarningAccepted">
          {(field) => (
            <AcknowledgementCard
              checked={field.state.value}
              text={ISP_WARNING_TEXT}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
      );
    default:
      return null;
  }
}

function ChoiceButton({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-md border px-4 py-4 text-left text-sm transition",
        selected
          ? "border-red-500 bg-red-500/10 text-white"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600",
      )}
    >
      {label}
    </button>
  );
}

function AcknowledgementCard({
  checked,
  text,
  onChange,
}: {
  checked: boolean;
  text: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-md border px-4 py-4 text-sm transition",
        checked
          ? "border-red-500 bg-red-500/10 text-zinc-200"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-300",
      )}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-red-500"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{text}</span>
    </label>
  );
}
