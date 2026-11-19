import { DIRECT_PLAYBACK_HINT } from "@jedflix/shared";
import { Platform } from "react-native";

export function isIosDevice(): boolean {
  return Platform.OS === "ios";
}

export const IOS_PLAYBACK_HINT = DIRECT_PLAYBACK_HINT;
