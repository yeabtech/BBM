import { DomainError } from "../errors/domain-error.js";

export const GUEST_COLORS = [
  "mint",
  "coral",
  "sun",
  "sky",
  "violet",
  "blue",
] as const;
export type GuestColor = (typeof GUEST_COLORS)[number];

export const GUEST_BALL_SKINS = [
  "soccer",
  "basketball",
  "volleyball",
  "beach",
] as const;
export type GuestBallSkin = (typeof GUEST_BALL_SKINS)[number];

export function parseGuestBallSkin(value: unknown): GuestBallSkin {
  if (
    typeof value !== "string" ||
    !GUEST_BALL_SKINS.includes(value as GuestBallSkin)
  ) {
    throw new DomainError(
      "INVALID_BALL_SKIN",
      "Choose one of the available ball styles.",
    );
  }
  return value as GuestBallSkin;
}

export function colorForBallSkin(skin: GuestBallSkin): GuestColor {
  switch (skin) {
    case "soccer":
      return "mint";
    case "basketball":
      return "coral";
    case "volleyball":
      return "sun";
    case "beach":
      return "sky";
  }
}

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string")
    throw new DomainError(
      "INVALID_NAME",
      "Enter a display name from 2 to 20 characters.",
    );
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    }) ||
    [...normalized].length < 2 ||
    [...normalized].length > 20
  ) {
    throw new DomainError(
      "INVALID_NAME",
      "Enter a display name from 2 to 20 characters.",
    );
  }
  return normalized;
}

export function parseGuestColor(value: unknown): GuestColor {
  if (
    typeof value !== "string" ||
    !GUEST_COLORS.includes(value as GuestColor)
  ) {
    throw new DomainError(
      "INVALID_COLOR",
      "Choose one of the available ball colors.",
    );
  }
  return value as GuestColor;
}
