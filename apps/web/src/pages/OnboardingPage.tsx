import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserSettings } from "@/hooks/useUserSettings";
import { validateLetterboxdUsername } from "@/lib/letterboxd";
import {
  CONTENT_TYPE_OPTIONS,
  DEVICE_TYPE_OPTIONS,
  EXTERNAL_PLAYER_OPTIONS,
  ISP_WARNING_TEXT,
  ONBOARDING_STEPS,
  type OnboardingFormValues,
  type OnboardingStepId,
  isContentTypeLockedWithoutDebrid,
  toggleContentType,
  validateOnboardingStep,
  validateOnboardingValues,
  VIRUS_WARNING_TEXT,
} from "@/lib/settingsForm";
import type { DeviceType, ExternalPlayer } from "@/lib/userSettings";
import { withoutDebridContentTypes } from "@/lib/userSettings";
import { cn } from "@/lib/utils";
import "./onboarding.css";

const REAL_DEBRID_API_KEY_URL = "https://real-debrid.com/apitoken";
const REAL_DEBRID_AFFILIATE_URL = "http://real-debrid.com/?id=10515937";
const WELCOME_EXIT_MS = 700;
const EXTERNAL_PLAYER_RECOMMENDED: ExternalPlayer[] = ["vlc", "outplayer"];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { settings, saveSettings } = useUserSettings();
  const [stepIndex, setStepIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isWelcomeExiting, setIsWelcomeExiting] = useState(false);

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
        realDebridApiKey: value.realDebridApiKey.trim() || undefined,
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
    setIsWelcomeExiting(false);
    setStepIndex((current) => Math.max(0, current - 1));
  }

  async function goNext(options?: { skipRealDebrid?: boolean }) {
    if (isWelcomeExiting) return;

    if (options?.skipRealDebrid && step.id === "realDebridApiKey") {
      form.setFieldValue("realDebridApiKey", "");
      form.setFieldValue(
        "contentTypes",
        withoutDebridContentTypes(form.state.values.contentTypes),
      );
      setStepError(null);
      setStepIndex((current) => Math.min(ONBOARDING_STEPS.length - 1, current + 1));
      return;
    }

    const values = form.state.values;
    const error = validateOnboardingStep(step.id, values);
    if (error) {
      setStepError(error);
      return;
    }

    if (step.id === "realDebridApiKey" && !values.realDebridApiKey.trim()) {
      form.setFieldValue(
        "contentTypes",
        withoutDebridContentTypes(values.contentTypes),
      );
    }

    if (step.id === "welcome") {
      setIsWelcomeExiting(true);
      setStepError(null);
      window.setTimeout(() => {
        setStepIndex(1);
        setIsWelcomeExiting(false);
      }, WELCOME_EXIT_MS);
      return;
    }

    if (step.id === "letterboxdUsername") {
      const raw = values.letterboxdUsername.trim();
      if (raw) {
        setIsVerifying(true);
        setStepError(null);
        const verified = await validateLetterboxdUsername(raw);
        setIsVerifying(false);
        if (verified.error) {
          setStepError(verified.error);
          return;
        }
        if (verified.username) {
          form.setFieldValue("letterboxdUsername", verified.username);
        }
      } else {
        form.setFieldValue("letterboxdUsername", "");
      }
    }

    setStepError(null);

    if (isLast) {
      void form.handleSubmit();
      return;
    }
    setStepIndex((current) => Math.min(ONBOARDING_STEPS.length - 1, current + 1));
  }

  return (
    <div
      className={cn(
        "onboarding-shell bg-zinc-950 text-white",
        isWelcomeExiting && "onboarding-shell-exit",
      )}
    >
      <main className={cn("onboarding-main", isFirst && "onboarding-main-welcome")}>
        {!isFirst ? (
          <div className="mb-6 flex shrink-0 items-center justify-between gap-3">
            <p className="text-sm font-medium uppercase tracking-wide text-red-500">JedFlix</p>
            <p className="text-xs text-zinc-500">
              Step {questionNumber} of {questionTotal}
            </p>
          </div>
        ) : null}

        {!isFirst ? (
          <div className="mb-6 flex shrink-0 gap-1.5" aria-hidden>
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

        <div className="onboarding-body">
          <div
            key={step.id}
            className={cn(
              "onboarding-scroll",
              isFirst
                ? isWelcomeExiting
                  ? "onboarding-welcome-exit"
                  : "onboarding-welcome-enter"
                : "onboarding-step-enter",
            )}
          >
            {step.id === "welcome" ? (
              <WelcomeStep exiting={isWelcomeExiting} />
            ) : (
              <>
                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{step.title}</h1>
                <p className="mt-2 text-zinc-400 md:text-lg">{step.description}</p>
                <div className="mt-8">
                  <StepFields stepId={step.id} form={form} />
                </div>
              </>
            )}
            {stepError ? <p className="mt-4 text-sm text-red-400">{stepError}</p> : null}
          </div>

          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <div
                className={cn(
                  "onboarding-footer flex items-center gap-3",
                  isFirst ? "justify-center border-0" : "justify-between",
                )}
              >
                {!isFirst ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="border-zinc-700 bg-transparent"
                    disabled={isSubmitting || isVerifying}
                    onClick={goBack}
                  >
                    Back
                  </Button>
                ) : null}
                <div className="flex items-center gap-3">
                  {step.id === "realDebridApiKey" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-zinc-400 hover:bg-zinc-900 hover:text-white"
                      disabled={isSubmitting || isVerifying || isWelcomeExiting}
                      onClick={() => void goNext({ skipRealDebrid: true })}
                    >
                      Skip
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size={isFirst ? "lg" : "default"}
                    className={cn(isFirst && "onboarding-cta min-w-[12rem] px-10 text-base")}
                    disabled={isSubmitting || isVerifying || isWelcomeExiting}
                    onClick={() => void goNext()}
                  >
                    {isVerifying
                      ? "Checking Letterboxd..."
                      : isSubmitting
                        ? "Saving..."
                        : isFirst
                          ? "Get started"
                          : isLast
                            ? "Finish"
                            : "Continue"}
                  </Button>
                </div>
              </div>
            )}
          </form.Subscribe>
        </div>
      </main>
    </div>
  );
}

function WelcomeStep({ exiting }: { exiting: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-full flex-col items-center justify-center py-4 text-center",
        exiting && "onboarding-welcome-content-exit",
      )}
    >
      <div className="onboarding-hero relative mb-10 h-44 w-full max-w-sm md:mb-12 md:h-56 md:max-w-md" aria-hidden>
        <div className="onboarding-poster onboarding-poster-left" />
        <div className="onboarding-poster onboarding-poster-right" />
        <div className="onboarding-poster onboarding-poster-center">
          <span className="onboarding-play" />
        </div>
        <div className="onboarding-spark onboarding-spark-a" />
        <div className="onboarding-spark onboarding-spark-b" />
        <div className="onboarding-spark onboarding-spark-c" />
      </div>
      <div className="onboarding-welcome-copy">
        <p className="onboarding-brand text-5xl font-black tracking-tight text-red-600 md:text-7xl">
          JedFlix
        </p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight md:text-4xl">
          The Ultimate Streaming Platform
        </h1>
        <p className="mt-3 max-w-lg text-zinc-400 md:mt-4 md:max-w-xl md:text-lg">
          Stream movies, shows, and audiobooks and download games from Real-Debrid with built-in
          Letterboxd integration.
        </p>
      </div>
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
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {DEVICE_TYPE_OPTIONS.map((option) => (
                  <ChoiceButton
                    key={option.value}
                    selected={field.state.value === option.value}
                    label={option.label}
                    onClick={() => field.handleChange(option.value)}
                  />
                ))}
              </div>
              <p className="text-xs text-zinc-500">
                Device type optimizes streams for compatibility based on what you
                select.
              </p>
            </div>
          )}
        </form.Field>
      );
    case "contentTypes":
      return (
        <form.Subscribe selector={(state) => state.values.realDebridApiKey}>
          {(realDebridApiKey) => (
            <form.Field name="contentTypes">
              {(field) => (
                <div className="space-y-4">
                  {!realDebridApiKey.trim() ? (
                    <p className="rounded-md border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                      Without a Real Debrid key, only Music can be selected.
                      Movies, shows, audiobooks, and games stay locked.
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {CONTENT_TYPE_OPTIONS.map((option) => {
                      const locked = isContentTypeLockedWithoutDebrid(
                        option.value,
                        realDebridApiKey,
                      );
                      const checked = field.state.value.includes(option.value);
                      return (
                        <label
                          key={option.value}
                          className={cn(
                            "flex items-center gap-3 rounded-md border px-4 py-4 text-sm transition sm:flex-col sm:items-start sm:gap-2",
                            locked
                              ? "cursor-not-allowed border-zinc-900 bg-zinc-950/40 text-zinc-600"
                              : checked
                                ? "cursor-pointer border-red-500 bg-red-500/10 text-white"
                                : "cursor-pointer border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-red-500 disabled:cursor-not-allowed"
                            checked={checked}
                            disabled={locked}
                            onChange={(event) =>
                              field.handleChange(
                                toggleContentType(
                                  field.state.value,
                                  option.value,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                          <span>
                            {option.label}
                            {locked ? (
                              <span className="mt-1 block text-xs text-zinc-600">
                                Needs Real Debrid
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </form.Field>
          )}
        </form.Subscribe>
      );
    case "realDebridApiKey":
      return (
        <form.Field name="realDebridApiKey">
          {(field) => (
            <div className="space-y-3">
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
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button type="button" variant="outline" className="border-zinc-700 bg-transparent" asChild>
                  <a href={REAL_DEBRID_API_KEY_URL} target="_blank" rel="noreferrer">
                    Get API key from Real-Debrid
                  </a>
                </Button>
                <Button type="button" variant="outline" className="border-zinc-700 bg-transparent" asChild>
                  <a href={REAL_DEBRID_AFFILIATE_URL} target="_blank" rel="noreferrer">
                    Don&apos;t have Debrid?
                  </a>
                </Button>
              </div>
              <p className="text-sm text-zinc-500">
                Music works without Real Debrid. Skip if you only want to listen.
              </p>
            </div>
          )}
        </form.Field>
      );
    case "externalPlayer":
      return (
        <form.Subscribe selector={(state) => state.values.deviceType}>
          {(deviceType) => (
            <form.Field name="externalPlayer">
              {(field) => {
                const isMobileDevice = deviceType === "mobile";
                return (
                  <div className="space-y-3">
                    {isMobileDevice ? (
                      <p className="text-sm text-zinc-400">
                        On mobile, an external player is recommended for more
                        reliable playback.
                      </p>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-3">
                      {EXTERNAL_PLAYER_OPTIONS.map((option) => (
                        <ChoiceButton
                          key={option.value}
                          selected={field.state.value === option.value}
                          label={option.label}
                          recommended={
                            isMobileDevice &&
                            EXTERNAL_PLAYER_RECOMMENDED.includes(option.value)
                          }
                          onClick={() => field.handleChange(option.value)}
                        />
                      ))}
                    </div>
                  </div>
                );
              }}
            </form.Field>
          )}
        </form.Subscribe>
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
    case "warnings":
      return (
        <div className="space-y-3">
          <form.Field name="virusWarningAccepted">
            {(field) => (
              <AcknowledgementCard
                checked={field.state.value}
                text={VIRUS_WARNING_TEXT}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="ispWarningAccepted">
            {(field) => (
              <AcknowledgementCard
                checked={field.state.value}
                text={ISP_WARNING_TEXT}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </div>
      );
    default:
      return null;
  }
}

function ChoiceButton({
  selected,
  label,
  recommended,
  onClick,
}: {
  selected: boolean;
  label: string;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative w-full rounded-md border px-4 py-4 text-left text-sm transition sm:text-center",
        selected
          ? "border-red-500 bg-red-500/10 text-white"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600",
      )}
    >
      {recommended ? (
        <span className="mb-2 inline-block rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
          Recommended
        </span>
      ) : null}
      <span className="block">{label}</span>
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
