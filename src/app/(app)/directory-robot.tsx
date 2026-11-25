"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/lib/i18n-client";
import { playEffect } from "@/lib/sfx";
import { isSidebarRobot, robotVariants, type RobotVariant } from "./directory-robot-variants";
import type { mountRobotScene, RobotPose } from "./directory-robot-scene";
import styles from "./directory-robot.module.css";

const reactions = [
  { pose: "wave", message: "嗨！很高興見到你。" },
  { pose: "happy", message: "我今天很有精神！" },
  { pose: "heart", message: "送你一顆愛心。" },
] as const;

export function DirectoryRobot({ size = "default", variant = "directory", greeting = false, facing = 0 }: {
  size?: "default" | "compact";
  variant?: RobotVariant;
  greeting?: boolean;
  facing?: number;
}) {
  const { t } = useI18n();
  const [interaction, setInteraction] = useState({ step: -1, active: false });
  const [modelVariant, setModelVariant] = useState<RobotVariant | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mascot = useRef<HTMLDivElement>(null);
  const flatRobot = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const scene = useRef<ReturnType<typeof mountRobotScene>>(null);
  const latestPose = useRef<RobotPose>("idle");
  const latestFacing = useRef(facing);
  const reaction = interaction.active ? reactions[interaction.step % reactions.length] : null;
  const pose = reaction?.pose ?? (greeting ? "wave" : "idle");
  const sidebar = isSidebarRobot(variant);
  const label = t("跟小機器人打招呼");
  const { antennas, shell, trim } = robotVariants[variant];
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
      scene.current.setFacing(latestFacing.current);
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
    latestFacing.current = facing;
    scene.current?.setFacing(facing);
  }, [facing]);

  useEffect(() => {
    if (!interaction.active) return;
    const timer = window.setTimeout(() => {
      setInteraction((current) => ({ ...current, active: false }));
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [interaction]);

  useEffect(() => {
    const label = bubble.current;
    const lane = mascot.current;
    const model = host.current;
    if (!reaction || !label || !lane || !model) return;
    let frame: number;

    const positionBubble = () => {
      const laneBounds = lane.getBoundingClientRect();
      const modelBounds = model.getBoundingClientRect();
      const flatBounds = flatRobot.current?.getBoundingClientRect() ?? modelBounds;
      const anchor = scene.current?.getBubbleAnchor();
      const x = anchor ? modelBounds.left + anchor.x * modelBounds.width : (flatBounds.left + flatBounds.right) / 2;
      const top = anchor ? modelBounds.top + anchor.top * modelBounds.height : flatBounds.top;
      const bottom = anchor ? modelBounds.top + anchor.bottom * modelBounds.height : flatBounds.bottom;
      const width = label.offsetWidth;
      const height = label.offsetHeight;
      const gap = 5;
      const minY = sidebar ? Math.max(gap, laneBounds.top) : gap;
      const maxY = sidebar ? laneBounds.bottom : document.documentElement.clientHeight - gap;
      const above = top - height - gap;
      const y = above >= minY ? above : Math.max(minY, Math.min(bottom + gap, maxY - height));
      const left = Math.max(gap, Math.min(x - width / 2, document.documentElement.clientWidth - width - gap));
      label.style.transform = `translate(${Math.round(left - laneBounds.left)}px, ${Math.round(y - laneBounds.top)}px)`;
      frame = requestAnimationFrame(positionBubble);
    };

    positionBubble();
    return () => cancelAnimationFrame(frame);
  }, [reaction, sidebar]);

  return (
    <div
      ref={mascot}
      className={styles.mascot}
      data-pose={pose}
      data-size={size}
      data-robot-variant={variant}
      data-sidebar-robot={sidebar || undefined}
      style={{
        "--robot-shell": shell,
        "--robot-trim": trim,
        "--robot-facing": `${facing}rad`,
      } as CSSProperties}
    >
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
              <span ref={flatRobot} className={styles.robot}>
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
      <span ref={bubble} className={styles.bubble} role="status">{reaction ? t(reaction.message) : ""}</span>
    </div>
  );
}
