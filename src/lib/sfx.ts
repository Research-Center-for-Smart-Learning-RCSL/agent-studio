"use client";
import { getAudioSettings } from "./audio-settings";

export type Effect = "click" | "nav" | "on" | "off" | "select" | "open" | "close" | "success" | "error" | "robot";

let context: AudioContext | null = null;
let lastAt = 0;

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
function note(ctx: AudioContext, start: number, frequency: number, length: number, peak: number, type: OscillatorType, glideTo?: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, start + length);
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
  // One gesture often raises two signals (a click and the dialog it opens); the first sound is enough.
  const nowMs = performance.now();
  if (effect !== "robot" && nowMs - lastAt < 45) return;
  lastAt = nowMs;
  const ctx = audioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  const level = volume * 0.5;
  switch (effect) {
    case "click":
      note(ctx, t, 880, 0.09, level * 0.7, "sine");
      note(ctx, t + 0.025, 1320, 0.07, level * 0.35, "sine");
      break;
    case "nav":
      // A soft upward swish for going somewhere.
      note(ctx, t, 400, 0.16, level * 0.5, "sine", 900);
      note(ctx, t + 0.05, 1200, 0.1, level * 0.2, "sine");
      break;
    case "on":
      note(ctx, t, 660, 0.08, level * 0.6, "sine");
      note(ctx, t + 0.06, 990, 0.11, level * 0.6, "sine");
      break;
    case "off":
      note(ctx, t, 990, 0.08, level * 0.6, "sine");
      note(ctx, t + 0.06, 660, 0.11, level * 0.5, "sine");
      break;
    case "select":
      note(ctx, t, 740, 0.08, level * 0.55, "triangle");
      break;
    case "open":
      note(ctx, t, 520, 0.12, level * 0.5, "sine", 780);
      note(ctx, t + 0.07, 1040, 0.1, level * 0.25, "sine");
      break;
    case "close":
      note(ctx, t, 780, 0.12, level * 0.45, "sine", 500);
      break;
    case "success":
      [659.25, 830.61, 987.77].forEach((f, i) => note(ctx, t + i * 0.07, f, 0.16, level * 0.6, "triangle"));
      break;
    case "error":
      note(ctx, t, 300, 0.14, level * 0.6, "square", 220);
      note(ctx, t + 0.1, 220, 0.18, level * 0.5, "square", 160);
      break;
    case "robot":
      // A short rising chirp with a sparkle on top.
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(ctx, t + i * 0.085, f, 0.18, level * 0.8, "triangle"));
      note(ctx, t + 0.34, 2093, 0.22, level * 0.25, "sine");
      break;
  }
}

/** The element in the page a click landed on, and what kind of sound it earns. */
function effectForClick(target: HTMLElement): Effect | "toggle" | null {
  if (target.closest("[data-sound]")) return null;
  const choice = target.closest(".ant-select-item-option, .ant-dropdown-menu-item, .ant-tabs-tab, .ant-segmented-item, .ant-pagination-item, .ant-pagination-prev, .ant-pagination-next, .ant-menu-item, .ant-cascader-menu-item");
  if (choice) return "select";
  const toggle = target.closest(".ant-switch, .ant-checkbox-wrapper, .ant-radio-wrapper, .ant-radio-button-wrapper, input[type=checkbox], input[type=radio]");
  if (toggle) return "toggle";
  if (target.closest("a[href], tr[class*=clickRow], tr.agent-row, .ant-table-row[tabindex]")) return "nav";
  if (target.closest("button:not([disabled]), [role=button], .ant-select:not(.ant-select-disabled), .ant-btn")) return "click";
  return null;
}

function toggleEffect(target: HTMLElement): Effect {
  const control = target.closest(".ant-switch, .ant-checkbox-wrapper, .ant-radio-wrapper, .ant-radio-button-wrapper") ?? target;
  const input = control.matches("input") ? (control as HTMLInputElement) : control.querySelector("input");
  // The click lands before the control updates, so a switch that is off now is about to be on.
  if (control.matches(".ant-switch")) return control.getAttribute("aria-checked") === "true" ? "off" : "on";
  if (input?.type === "radio") return "on";
  return input?.checked ? "off" : "on";
}

/** Sounds for clicks everywhere on the page, for dialogs and drawers opening and closing, and for notices; returns the cleanup. */
export function installSoundEffects(): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const effect = effectForClick(target);
    if (!effect) return;
    playEffect(effect === "toggle" ? toggleEffect(target) : effect);
  };

  const notice = ".ant-message-notice, .ant-notification-notice";
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const messageNode = node.matches(notice) ? node : node.querySelector(notice);
        if (messageNode) {
          const failed = messageNode.querySelector(".anticon-close-circle, .anticon-exclamation-circle, .ant-notification-notice-icon-error, .ant-notification-notice-icon-warning");
          const done = messageNode.querySelector(".anticon-check-circle, .ant-notification-notice-icon-success");
          if (failed) playEffect("error");
          else if (done) playEffect("success");
          continue;
        }
        if (node.matches(".ant-modal-wrap, .ant-drawer") || node.querySelector(":scope > .ant-modal-wrap, :scope > .ant-drawer")) playEffect("open");
      }
      for (const node of record.removedNodes) {
        if (node instanceof HTMLElement && node.matches(".ant-modal-wrap, .ant-drawer")) playEffect("close");
      }
    }
  });
  document.addEventListener("click", onClick, true);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    document.removeEventListener("click", onClick, true);
    observer.disconnect();
  };
}
