import type { ContentType, DeviceType, ExternalPlayer } from "@/lib/userSettings";

export const DEVICE_TYPE_OPTIONS: Array<{ value: DeviceType; label: string }> = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "tv", label: "TV" },
];

export const CONTENT_TYPE_OPTIONS: Array<{ value: ContentType; label: string }> = [
  { value: "movies_shows", label: "Movies & Shows" },
  { value: "audiobooks", label: "Audiobooks" },
  { value: "video_games", label: "Video Games" },
];

export const EXTERNAL_PLAYER_OPTIONS: Array<{ value: ExternalPlayer; label: string }> = [
  { value: "disabled", label: "Built-in player" },
  { value: "vlc", label: "VLC" },
  { value: "outplayer", label: "OutPlayer" },
];

export const VIRUS_WARNING_TEXT =
  "I understand that torrent sources and third-party stream files may contain malware or other unwanted software, and I accept the risk of scanning and opening media from untrusted releases.";

export const ISP_WARNING_TEXT =
  "I understand that streaming via Real Debrid and torrent-backed sources may be visible to my ISP or network administrator, and I accept responsibility for complying with local laws and my network policies.";

export type OnboardingFormValues = {
  deviceType: DeviceType | "";
  contentTypes: ContentType[];
  realDebridApiKey: string;
  externalPlayer: ExternalPlayer | "";
  letterboxdUsername: string;
  virusWarningAccepted: boolean;
  ispWarningAccepted: boolean;
};

export type OnboardingStepId =
  | "welcome"
  | "deviceType"
  | "contentTypes"
  | "realDebridApiKey"
  | "externalPlayer"
  | "letterboxdUsername"
  | "virusWarning"
  | "ispWarning";

export const ONBOARDING_STEPS: Array<{
  id: OnboardingStepId;
  title: string;
  description: string;
}> = [
  {
    id: "welcome",
    title: "Welcome to JedFlix",
    description: "A few quick questions and you are ready to stream.",
  },
  {
    id: "deviceType",
    title: "What device are you on?",
    description: "We will remember this preference for later features.",
  },
  {
    id: "contentTypes",
    title: "What do you want to browse?",
    description: "Pick the library tabs to show. You can change this later.",
  },
  {
    id: "realDebridApiKey",
    title: "Add your Real Debrid key",
    description: "Required for direct streaming from your browser.",
  },
  {
    id: "externalPlayer",
    title: "How do you want to play?",
    description: "Use the built-in player or hand off to VLC / OutPlayer.",
  },
  {
    id: "letterboxdUsername",
    title: "Letterboxd username",
    description:
      "Optional — personalize your home feed with recent watches. Profile must be public and have diary entries.",
  },
  {
    id: "virusWarning",
    title: "Virus warning",
    description: "Please read and accept before continuing.",
  },
  {
    id: "ispWarning",
    title: "ISP warning",
    description: "One last acknowledgement, then you are in.",
  },
];

export function validateOnboardingStep(
  stepId: OnboardingStepId,
  values: OnboardingFormValues,
): string | undefined {
  switch (stepId) {
    case "welcome":
    case "letterboxdUsername":
      return undefined;
    case "deviceType":
      return values.deviceType ? undefined : "Select a device type.";
    case "contentTypes":
      return values.contentTypes.length > 0 ? undefined : "Select at least one content type.";
    case "realDebridApiKey":
      return values.realDebridApiKey.trim() ? undefined : "Enter your Real Debrid API key.";
    case "externalPlayer":
      return values.externalPlayer ? undefined : "Select a player preference.";
    case "virusWarning":
      return values.virusWarningAccepted ? undefined : "You must accept the virus warning.";
    case "ispWarning":
      return values.ispWarningAccepted ? undefined : "You must accept the ISP warning.";
    default:
      return undefined;
  }
}

export function validateOnboardingValues(values: OnboardingFormValues): string | undefined {
  for (const step of ONBOARDING_STEPS) {
    const error = validateOnboardingStep(step.id, values);
    if (error) {
      return error;
    }
  }
  return undefined;
}

export function toggleContentType(
  current: ContentType[],
  value: ContentType,
  checked: boolean,
): ContentType[] {
  if (checked) {
    return current.includes(value) ? current : [...current, value];
  }
  return current.filter((item) => item !== value);
}
