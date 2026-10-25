import { useEffect, useRef, useState } from "react";
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

function addStylesheet(id: string, href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) return resolve();
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      reject(new Error(href));
    };
    document.head.appendChild(link);
  });
}

/**
 * Carrega uma fonte do Google Fonts no peso pedido e segura o render
 * (delayRender) até ela estar disponível — vale tanto para o preview quanto
 * para o render headless. Fontes de sistema são ignoradas.
 *
 * O Google recusa pesos que a família não tem (ex.: Oswald 900); nesse caso
 * carrega a versão base e o navegador simula o peso.
 */
export function useGoogleFont(family: string, weight = 900): boolean {
  const isSystem = !family.trim() || SYSTEM_FONTS.has(family.trim());
  const [ready, setReady] = useState(isSystem);
  const pending = useRef<number | null>(null);

  // o render só continua depois que o React redesenhou com a fonte pronta
  // (quem mede texto precisa da medida certa no frame capturado)
  useEffect(() => {
    if (ready && pending.current !== null) {
      continueRender(pending.current);
      pending.current = null;
    }
  }, [ready]);

  useEffect(() => {
    const name = family.trim();
    if (!name || SYSTEM_FONTS.has(name)) {
      setReady(true);
      return;
    }
    setReady(false);
    const handle = delayRender(`google font ${name} ${weight}`);
    pending.current = handle;
    let cancelled = false;
    const done = () => {
      if (!cancelled) {
        cancelled = true;
        setReady(true);
      }
    };
    const slug = name.replace(/\s+/g, "-").toLowerCase();
    const param = name.replace(/\s+/g, "+");
    addStylesheet(
      `google-font-${slug}-${weight}`,
      `https://fonts.googleapis.com/css2?family=${param}:wght@${weight}&display=block`
    )
      .catch(() =>
        addStylesheet(
          `google-font-${slug}`,
          `https://fonts.googleapis.com/css2?family=${param}&display=block`
        )
      )
      .then(() => document.fonts.load(`${weight} 16px "${name}"`))
      .then(done, done);
    return () => {
      // desmontou antes de carregar: libera o render
      if (!cancelled) {
        cancelled = true;
        if (pending.current !== null) {
          continueRender(pending.current);
          pending.current = null;
        }
      }
    };
  }, [family, weight]);

  return ready;
}
