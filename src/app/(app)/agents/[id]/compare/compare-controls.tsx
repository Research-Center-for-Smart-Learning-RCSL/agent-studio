"use client";

import { useRouter } from "next/navigation";
import { Select, Space } from "antd";

export function CompareControls(props: { agentId: string; versions: number[]; a: number | null; b: number | null }) {
  const router = useRouter();
  const options = props.versions.map((v) => ({ value: v, label: `v${v}` }));
  const go = (a: number | null, b: number | null) => router.push(`/agents/${props.agentId}/compare?a=${a ?? ""}&b=${b ?? ""}`);
  return (
    <Space style={{ marginBottom: 16 }}>
      <Select style={{ width: 100 }} value={props.a} options={options} onChange={(a) => go(a, props.b)} />
      <span>→</span>
      <Select style={{ width: 100 }} value={props.b} options={options} onChange={(b) => go(props.a, b)} />
    </Space>
  );
}
