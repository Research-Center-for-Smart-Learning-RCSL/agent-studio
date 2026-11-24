import { Suspense } from "react";
import { TurnList } from "../turn-list";

export default function TurnsPage() {
  return (
    <Suspense>
      <TurnList />
    </Suspense>
  );
}
