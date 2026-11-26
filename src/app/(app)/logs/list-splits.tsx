"use client";
import type { ReactNode } from "react";
import { ConversationList } from "./conversation-list";
import { SplitLayout } from "./split-layout";
import { TurnList } from "./turn-list";

// Client components, because the list is a function of the pane state and cannot cross from a server layout.
export function ConversationsSplit({ children }: { children: ReactNode }) {
  return (
    <SplitLayout listPath="/logs" detailBase="/logs/conversations" list={(pane, selected) => <ConversationList pane={pane} selected={selected} />}>
      {children}
    </SplitLayout>
  );
}

export function TurnsSplit({ children }: { children: ReactNode }) {
  return (
    <SplitLayout listPath="/logs/turns" detailBase="/logs/turns" list={(pane, selected) => <TurnList pane={pane} selected={selected} />}>
      {children}
    </SplitLayout>
  );
}
