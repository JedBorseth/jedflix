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

export function validateOnboardingValues(values: OnboardingFormValues): string | undefined {
  if (!values.deviceType) {
    return "Select a device type.";
  }
  if (values.contentTypes.length === 0) {
    return "Select at least one content type.";
  }
  if (!values.realDebridApiKey.trim()) {
    return "Enter your Real Debrid API key.";
  }
  if (!values.externalPlayer) {
    return "Select an external player preference.";
  }
  if (!values.virusWarningAccepted) {
    return "You must accept the virus warning.";
  }
  if (!values.ispWarningAccepted) {
    return "You must accept the ISP warning.";
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
