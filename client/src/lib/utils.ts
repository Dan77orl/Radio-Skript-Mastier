import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getCleanVoiceName(voice: { personaName?: string | null; name: string }): string {
  if (voice.personaName) return voice.personaName;
  const name = voice.name;
  const dashIdx = name.indexOf(" - ");
  if (dashIdx > 0) return name.substring(0, dashIdx).trim();
  return name;
}
