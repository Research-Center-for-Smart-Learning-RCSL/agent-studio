"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-client";
import { playEffect } from "@/lib/sfx";
import { robotAntennas, type RobotVariant } from "./directory-robot-antennas";
import type { mountRobotScene, RobotPose } from "./directory-robot-scene";
import styles from "./directory-robot.module.css";

const reactions = [
  { pose: "wave", message: "嗨！很高興見到你。" },
  { pose: "happy", message: "我今天很有精神！" },
  { pose: "heart", message: "送你一顆愛心。" },
] as const;

export function DirectoryRobot({ size = "default", variant = "directory" }: {
  size?: "default" | "compact";
  variant?: RobotVariant;
}) {
  const { t } = useI18n();
  const [interaction, setInteraction] = useState({ step: -1, active: false });
  const [modelVariant, setModelVariant] = useState<RobotVariant | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const scene = useRef<ReturnType<typeof mountRobotScene>>(null);
  const latestPose = useRef<RobotPose>("idle");
  const reaction = interaction.active ? reactions[interaction.step % reactions.length] : null;
  const pose = reaction?.pose ?? "idle";
  const label = t("跟小機器人打招呼");
  const antennas = robotAntennas[variant];
  const modelReady = modelVariant === variant;

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let cancelled = false;
    const clearScene = () => {
      scene.current?.dispose();
      scene.current = null;
    };
    void import("./directory-robot-scene").then(({ mountRobotScene }) => {
      if (cancelled) return;
      scene.current = mountRobotScene(container, variant, () => {
        clearScene();
        setModelVariant(null);
      });
      if (!scene.current) return;
      scene.current.setPose(latestPose.current);
      scene.current.setAttentive(button.current?.matches(":hover, :focus-visible") ?? false);
      setModelVariant(variant);
    }).catch(() => {
      if (!cancelled) clearScene();
    });
    return () => {
      cancelled = true;
      clearScene();
    };
  }, [variant]);

  useEffect(() => {
    latestPose.current = pose;
    scene.current?.setPose(pose);
  }, [pose]);

  useEffect(() => {
    if (!interaction.active) return;
    const timer = window.setTimeout(() => {
      setInteraction((current) => ({ ...current, active: false }));
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [interaction]);

  return (
    <div className={styles.mascot} data-pose={pose} data-size={size}>
      <button
        ref={button}
        className={styles.button}
        type="button"
        aria-label={label}
        title={label}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") scene.current?.setAttentive(true);
        }}
        onPointerLeave={(event) => scene.current?.setAttentive(event.currentTarget.matches(":focus-visible"))}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) scene.current?.setAttentive(true);
        }}
        onBlur={(event) => scene.current?.setAttentive(event.currentTarget.matches(":hover"))}
        data-sound="robot"
        onClick={() => {
          playEffect("robot");
          setInteraction(({ step }) => ({ step: step + 1, active: true }));
        }}
      >
        <span className={styles.stage} aria-hidden="true" data-model={modelReady ? "3d" : "flat"}>
          <span ref={host} className={styles.model} />
          {!modelReady && (
            <span className={styles.flatArt}>
              <span className={styles.shadow} />
              <span className={styles.robot}>
                <span className={styles.armLeft} />
                <span className={styles.armRight} />
                <span className={styles.body}><span /></span>
                <span className={styles.head}>
                  {antennas.map(({ offset, tip }) => (
                    <span
                      key={offset}
                      className={styles.antenna}
                      style={{ left: `calc(50% + ${offset * 0.62}em - .07em)`, color: tip }}
                    />
                  ))}
                  <span className={styles.face}>
                    <span className={styles.eyes}><span /><span /></span>
                    <span className={styles.smile} />
                  </span>
                </span>
              </span>
              <span className={styles.heart}>♥</span>
            </span>
          )}
        </span>
      </button>
      <span className={styles.bubble} role="status">{reaction ? t(reaction.message) : ""}</span>
    </div>
  );
}
