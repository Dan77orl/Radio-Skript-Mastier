import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "preferredPlaybackRate";
const ALLOWED_RATES = [1, 1.5, 2] as const;

function readStoredRate(defaultRate: number): number {
  if (typeof window === "undefined") return defaultRate;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return defaultRate;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return defaultRate;
    return (ALLOWED_RATES as readonly number[]).includes(parsed)
      ? parsed
      : defaultRate;
  } catch {
    return defaultRate;
  }
}

export function usePlaybackRate(defaultRate: number = 1) {
  const [rate, setRateState] = useState<number>(() => readStoredRate(defaultRate));

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(rate));
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, [rate]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue == null) return;
      const parsed = parseFloat(e.newValue);
      if (
        Number.isFinite(parsed) &&
        (ALLOWED_RATES as readonly number[]).includes(parsed)
      ) {
        setRateState(parsed);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setRate = useCallback((next: number) => {
    setRateState(next);
  }, []);

  return [rate, setRate] as const;
}
