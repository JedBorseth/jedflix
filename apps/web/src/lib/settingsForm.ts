import {
  contentTypeRequiresRealDebrid,
  contentTypesRequiringRealDebrid,
  type ContentType,
  type DeviceType,
  type ExternalPlayer,
} from "@/lib/userSettings";

export const DEVICE_TYPE_OPTIONS: Array<{ value: DeviceType; label: string }> = [
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "tv", label: "TV" },
];

export const CONTENT_TYPE_OPTIONS: Array<{ value: ContentType; label: string }> = [
  { value: "movies_shows", label: "Movies & Shows" },
  { value: "audiobooks", label: "Audiobooks" },
  { value: "music", label: "Music" },
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
  | "warnings";

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
    description: "Select the device you are using now.",
  },
  {
    id: "realDebridApiKey",
    title: "Add your Real Debrid key",
    description:
      "Real Debrid is a premium service that unlocks instant streaming from torrent sources. JedFlix does not make any money from Real Debrid subscriptions — you can use the same account outside this app for instant torrenting. Needed for movies, shows, audiobooks, and games; skip if you only want music.",
  },
  {
    id: "contentTypes",
    title: "What do you want to browse?",
    description: "Pick the library tabs to show. You can change this later.",
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
    id: "warnings",
    title: "Before you continue",
    description: "Please read and accept both acknowledgements.",
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
    case "contentTypes": {
      if (values.contentTypes.length === 0) {
        return "Select at least one content type.";
      }
      if (!values.realDebridApiKey.trim() && contentTypesRequiringRealDebrid(values.contentTypes).length > 0) {
        return "Movies, shows, audiobooks, and games need a Real Debrid key. Select Music, or go back and add a key.";
      }
      return undefined;
    }
    case "realDebridApiKey":
      // Optional — music works without a key. Debrid content types are gated on the next step.
      return undefined;
    case "externalPlayer":
      return values.externalPlayer ? undefined : "Select a player preference.";
    case "warnings":
      if (!values.virusWarningAccepted) {
        return "You must accept the virus warning.";
      }
      if (!values.ispWarningAccepted) {
        return "You must accept the ISP warning.";
      }
      return undefined;
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

export function isContentTypeLockedWithoutDebrid(
  type: ContentType,
  realDebridApiKey: string,
): boolean {
  return contentTypeRequiresRealDebrid(type) && !realDebridApiKey.trim();
}
