import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "chatbot-theme";

const readMode = (): ThemeMode => {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
};

export const useTheme = (): { mode: ThemeMode; cycle: () => void } => {
  const [mode, setMode] = useState<ThemeMode>(readMode);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      return;
    }
  }, [mode]);

  const cycle = useCallback(() => {
    setMode((current) => (current === "system" ? "light" : current === "light" ? "dark" : "system"));
  }, []);

  return { mode, cycle };
};
