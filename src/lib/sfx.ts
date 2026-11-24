"use client";
import { getAudioSettings } from "./audio-settings";

export type Effect = "click" | "robot";

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

/** One soft note: a short attack, then a decay, so nothing clicks or rings. */
function note(ctx: AudioContext, start: number, frequency: number, length: number, peak: number, type: OscillatorType) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

/** Plays a synthesized effect at the shared volume; nothing is loaded, so there is no file to fetch or license. */
export function playEffect(effect: Effect) {
  const { effects, volume } = getAudioSettings();
  if (!effects || volume <= 0) return;
  const ctx = audioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const level = volume * 0.5;
  if (effect === "click") {
    note(ctx, now, 880, 0.09, level * 0.7, "sine");
    note(ctx, now + 0.025, 1320, 0.07, level * 0.35, "sine");
    return;
  }
  // A short rising chirp with a sparkle on top.
  [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => note(ctx, now + index * 0.085, frequency, 0.18, level * 0.8, "triangle"));
  note(ctx, now + 0.34, 2093, 0.22, level * 0.25, "sine");
}
