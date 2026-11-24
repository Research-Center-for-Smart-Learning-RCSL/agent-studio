import { Suspense } from "react";
import { SpeechList } from "../speech-view";

export default function SpeechPage() {
  return (
    <Suspense>
      <SpeechList />
    </Suspense>
  );
}
