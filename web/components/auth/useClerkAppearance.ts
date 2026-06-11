"use client";

import { useEffect, useState } from "react";
import {
  buildClerkAppearance,
  readAimThemeMode,
  type AimThemeMode,
} from "@/components/auth/clerk-appearance";

export function useClerkAppearance() {
  const [mode, setMode] = useState<AimThemeMode>("light");

  useEffect(() => {
    const sync = () => setMode(readAimThemeMode());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key === "aimtutor-theme") sync();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return buildClerkAppearance(mode);
}
