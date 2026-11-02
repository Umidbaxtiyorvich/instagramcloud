import { Suspense } from "react";
import type { Metadata } from "next";
import Qongiroq from "./Qongiroq";

export const metadata: Metadata = { title: "Miya — qo'ng'iroq" };

export default function Sahifa() {
  return (
    <Suspense>
      <Qongiroq />
    </Suspense>
  );
}
