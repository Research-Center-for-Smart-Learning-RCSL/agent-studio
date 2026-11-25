type Antenna = { offset: number; tip: string };

export const robotAntennas = {
  directory: [{ offset: 0, tip: "#a7b8aa" }],
  logs: [{ offset: -1, tip: "#a3b2bf" }, { offset: 1, tip: "#a3b2bf" }],
  admin: [{ offset: 0, tip: "#bba4ad" }],
  editor: [{ offset: -1, tip: "#bcb19c" }, { offset: 1, tip: "#bcb19c" }],
  sidebar: [{ offset: 0, tip: "#aca4bd" }],
} satisfies Record<string, Antenna[]>;

export type RobotVariant = keyof typeof robotAntennas;
