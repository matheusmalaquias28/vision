import { useEffect } from "react";
import { continueRender, delayRender } from "remotion";

const SYSTEM_FONTS = new Set([
  "Arial",
  "Arial Black",
  "Impact",
  "Georgia",
  "Verdana",
  "Segoe UI",
  "sans-serif",
]);

/**
 * Carrega uma fonte do Google Fonts e segura o render (delayRender) até
 * ela estar disponível — vale tanto para o preview quanto para o render
 * headless. Fontes de sistema são ignoradas.
 */
export function useGoogleFont(family: string): void {
  useEffect(() => {
    const name = family.trim();
    if (!name || SYSTEM_FONTS.has(name)) return;
    const handle = delayRender(`google font ${name}`);
    let cancelled = false;
    const done = () => {
      if (!cancelled) {
        cancelled = true;
        continueRender(handle);
      }
    };
    const waitForFont = () => {
      document.fonts.load(`900 16px "${name}"`).then(done, done);
    };
    const id = `google-font-${name.replace(/\s+/g, "-").toLowerCase()}`;
    const existing = document.getElementById(id);
    if (existing) {
      waitForFont();
    } else {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${name.replace(/\s+/g, "+")}:wght@400;700;900&display=block`;
      link.onload = waitForFont;
      link.onerror = done;
      document.head.appendChild(link);
    }
    return done;
  }, [family]);
}
