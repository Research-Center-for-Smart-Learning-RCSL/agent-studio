"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Slider, Switch } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { getAudioSettings, setAudioSettings, useAudioSettings } from "@/lib/audio-settings";
import { installSoundEffects } from "@/lib/sfx";
import styles from "./app-sound.module.css";

const tracks = [
  { src: "/music/gymnopedie-1.mp3", title: "Satie, Gymnopédie No. 1" },
  { src: "/music/nocturne-op9-no2.mp3", title: "Chopin, Nocturne Op. 9 No. 2" },
  { src: "/music/nocturne-op55-no2.mp3", title: "Chopin, Nocturne Op. 55 No. 2" },
] as const;

/** Click and dialog sounds and the background piano on every page (the element lives in the layout, so a page change does not stop it), and one panel to set the volume or turn either off. */
export function AppSound() {
  const { t } = useI18n();
  const settings = useAudioSettings();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const indexRef = useRef(0);
  const getMusicOn = () => getAudioSettings().music;

  const next = useCallback((step: number) => setIndex((i) => (i + step + tracks.length) % tracks.length), []);

  // The element lives as long as the page; the browser blocks it until the person has touched the page once.
  useEffect(() => {
    const element = new Audio();
    element.preload = "none";
    element.addEventListener("play", () => setPlaying(true));
    element.addEventListener("pause", () => setPlaying(false));
    element.addEventListener("ended", () => next(1));
    audio.current = element;
    return () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
      audio.current = null;
    };
  }, [next]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    indexRef.current = index;
    const wasPlaying = !element.paused;
    element.src = tracks[index].src;
    if (wasPlaying || (index !== 0 && getMusicOn())) void element.play().catch(() => undefined);
  }, [index]);

  useEffect(() => {
    const element = audio.current;
    if (element) element.volume = Math.min(1, settings.volume * 0.6);
  }, [settings.volume]);

  // Turning music on starts it; if the browser still blocks it, the first touch of the page does.
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    if (!settings.music) {
      element.pause();
      return;
    }
    const start = () => {
      if (!element.src) element.src = tracks[indexRef.current].src;
      void element.play().catch(() => undefined);
    };
    start();
    const events = ["pointerdown", "keydown"] as const;
    const retry = () => {
      if (element.paused && getMusicOn()) start();
      for (const name of events) window.removeEventListener(name, retry);
    };
    for (const name of events) window.addEventListener(name, retry);
    return () => { for (const name of events) window.removeEventListener(name, retry); };
  }, [settings.music]);

  useEffect(() => installSoundEffects(), []);

  const label = t("聲音設定");
  return (
    <div className={styles.dock} data-sound="panel">
      {open && (
        <div className={styles.panel} role="group" aria-label={label}>
          <label className={styles.row}>
            <span>{t("背景音樂")}</span>
            <Switch size="small" checked={settings.music} onChange={(music) => setAudioSettings({ music })} />
          </label>
          <label className={styles.row}>
            <span>{t("按鈕音效")}</span>
            <Switch size="small" checked={settings.effects} onChange={(effects) => setAudioSettings({ effects })} />
          </label>
          <div className={styles.row}>
            <span>{t("音量")}</span>
            <Slider
              className={styles.slider}
              min={0}
              max={100}
              value={Math.round(settings.volume * 100)}
              aria-label={t("音量")}
              onChange={(value) => setAudioSettings({ volume: value / 100 })}
            />
          </div>
          <div className={styles.track}>
            <span className={styles.title} aria-live="polite">{settings.music ? tracks[index].title : t("背景音樂已關閉")}</span>
            <span className={styles.skip}>
              <Button size="small" type="text" aria-label={t("上一首")} disabled={!settings.music} onClick={() => next(-1)}>‹</Button>
              <Button size="small" type="text" aria-label={t("下一首")} disabled={!settings.music} onClick={() => next(1)}>›</Button>
            </span>
          </div>
          <p className={styles.credit}>{t("鋼琴曲來自 Musopen，公有領域或 CC0。")}</p>
        </div>
      )}
      <button
        type="button"
        className={`${styles.toggle}${settings.music && playing ? ` ${styles.on}` : ""}`}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {settings.music || settings.effects ? "♪" : "♪̸"}
      </button>
    </div>
  );
}
