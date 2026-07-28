import { useForm } from "@tanstack/react-form";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserSettings } from "@/hooks/useUserSettings";
import {
  CONTENT_TYPE_OPTIONS,
  DEVICE_TYPE_OPTIONS,
  EXTERNAL_PLAYER_OPTIONS,
  ISP_WARNING_TEXT,
  type OnboardingFormValues,
  toggleContentType,
  validateOnboardingValues,
  VIRUS_WARNING_TEXT,
} from "@/lib/settingsForm";
import type { DeviceType, ExternalPlayer } from "@/lib/userSettings";
import { cn } from "@/lib/utils";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { settings, saveSettings } = useUserSettings();

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
        throw new Error(error);
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

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <main className="mx-auto flex max-w-2xl flex-col px-4 py-10 md:px-8 md:py-16">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-wide text-red-500">JedFlix</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Set up your app</h1>
          <p className="mt-2 text-zinc-400">
            Complete these preferences to start browsing. You can change them anytime in Settings.
          </p>
        </div>

        <form
          className="space-y-8"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="deviceType"
            validators={{
              onChange: ({ value }) => (!value ? "Select a device type." : undefined),
            }}
          >
            {(field) => (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-zinc-200">Device type</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {DEVICE_TYPE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={cn(
                        "flex cursor-pointer items-center justify-center rounded-md border px-3 py-3 text-sm transition",
                        field.state.value === option.value
                          ? "border-red-500 bg-red-500/10 text-white"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600",
                      )}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={field.name}
                        value={option.value}
                        checked={field.state.value === option.value}
                        onBlur={field.handleBlur}
                        onChange={() => field.handleChange(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <FieldError message={field.state.meta.errors[0]} />
              </fieldset>
            )}
          </form.Field>

          <form.Field
            name="contentTypes"
            validators={{
              onChange: ({ value }) =>
                value.length === 0 ? "Select at least one content type." : undefined,
            }}
          >
            {(field) => (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-zinc-200">Content</legend>
                <p className="text-sm text-zinc-500">
                  Choose which library tabs to show. Extra catalogs can be filled in later.
                </p>
                <div className="space-y-2">
                  {CONTENT_TYPE_OPTIONS.map((option) => {
                    const checked = field.state.value.includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-200"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-red-500"
                          checked={checked}
                          onBlur={field.handleBlur}
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
                        {option.label}
                      </label>
                    );
                  })}
                </div>
                <FieldError message={field.state.meta.errors[0]} />
              </fieldset>
            )}
          </form.Field>

          <form.Field
            name="realDebridApiKey"
            validators={{
              onChange: ({ value }) =>
                !value.trim() ? "Enter your Real Debrid API key." : undefined,
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-200" htmlFor={field.name}>
                  Real Debrid API key
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="off"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Paste your Real Debrid API key"
                  className="border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-600"
                />
                <FieldError message={field.state.meta.errors[0]} />
              </div>
            )}
          </form.Field>

          <form.Field
            name="externalPlayer"
            validators={{
              onChange: ({ value }) => (!value ? "Select a player preference." : undefined),
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-200" htmlFor={field.name}>
                  External player
                </label>
                <Select
                  value={field.state.value || undefined}
                  onValueChange={(value) => field.handleChange(value as ExternalPlayer)}
                >
                  <SelectTrigger id={field.name} className="border-zinc-700 bg-zinc-900">
                    <SelectValue placeholder="Choose a player" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXTERNAL_PLAYER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={field.state.meta.errors[0]} />
              </div>
            )}
          </form.Field>

          <form.Field name="letterboxdUsername">
            {(field) => (
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-200" htmlFor={field.name}>
                  Letterboxd username
                  <span className="ml-2 font-normal text-zinc-500">(optional)</span>
                </label>
                <Input
                  id={field.name}
                  type="text"
                  autoComplete="username"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="your-username"
                  className="border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-600"
                />
              </div>
            )}
          </form.Field>

          <form.Field
            name="virusWarningAccepted"
            validators={{
              onChange: ({ value }) => (!value ? "Required." : undefined),
            }}
          >
            {(field) => (
              <label className="flex cursor-pointer gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-red-500"
                  checked={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.checked)}
                />
                <span>
                  <span className="font-medium text-zinc-100">Virus warning</span>
                  <span className="mt-1 block text-zinc-400">{VIRUS_WARNING_TEXT}</span>
                  <FieldError message={field.state.meta.errors[0]} />
                </span>
              </label>
            )}
          </form.Field>

          <form.Field
            name="ispWarningAccepted"
            validators={{
              onChange: ({ value }) => (!value ? "Required." : undefined),
            }}
          >
            {(field) => (
              <label className="flex cursor-pointer gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-red-500"
                  checked={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.checked)}
                />
                <span>
                  <span className="font-medium text-zinc-100">ISP warning</span>
                  <span className="mt-1 block text-zinc-400">{ISP_WARNING_TEXT}</span>
                  <FieldError message={field.state.meta.errors[0]} />
                </span>
              </label>
            )}
          </form.Field>

          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting, state.errors] as const}
          >
            {([canSubmit, isSubmitting, errors]) => (
              <div className="space-y-3 border-t border-zinc-800 pt-6">
                {typeof errors[0] === "string" ? <FieldError message={errors[0]} /> : null}
                <Button type="submit" disabled={!canSubmit || isSubmitting} className="w-full sm:w-auto">
                  {isSubmitting ? "Saving..." : "Finish setup"}
                </Button>
              </div>
            )}
          </form.Subscribe>
        </form>
      </main>
    </div>
  );
}

function FieldError({ message }: { message?: unknown }) {
  if (!message) {
    return null;
  }
  const text = typeof message === "string" ? message : String(message);
  return <p className="mt-1 text-sm text-red-400">{text}</p>;
}
