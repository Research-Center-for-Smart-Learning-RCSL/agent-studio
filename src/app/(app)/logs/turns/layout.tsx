import { Suspense } from "react";
import { TurnsSplit } from "../list-splits";

export default function TurnsLayout({ children }: LayoutProps<"/logs/turns">) {
  return (
    <Suspense>
      <TurnsSplit>{children}</TurnsSplit>
    </Suspense>
  );
}
