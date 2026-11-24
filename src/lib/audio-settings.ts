"use client";
import { useSyncExternalStore } from "react";

export type AudioSettings = { music: boolean; effects: boolean; volume: number };

const storageKey = "agent-studio:audio";
const defaults: AudioSettings = { music: true, effects: true, volume: 0.5 };
const listeners = new Set<() => void>();
let current: AudioSettings = defaults;
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<AudioSettings> | null;
    if (saved) {
      current = {
        music: typeof saved.music === "boolean" ? saved.music : defaults.music,
        effects: typeof saved.effects === "boolean" ? saved.effects : defaults.effects,
        volume: typeof saved.volume === "number" && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : defaults.volume,
      };
    }
  } catch { /* Storage can be unavailable; the defaults apply. */ }
}

export function getAudioSettings(): AudioSettings {
  load();
  return current;
}

export function setAudioSettings(patch: Partial<AudioSettings>) {
  load();
  current = { ...current, ...patch };
  try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* Not persisted. */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The server and the first client render use the defaults, so hydration matches; the saved choice follows. */
export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(subscribe, getAudioSettings, () => defaults);
}
