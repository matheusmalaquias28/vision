import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser } from "@remotion/renderer";
import { mediaDir, repoRoot } from "../paths";

/**
 * Bundle do Remotion, um por processo. O bundle leva a pasta pública junto
 * (media/: biblioteca + projetos, vários GB); antes cada render fazia um
 * bundle novo e nunca apagava a cópia em %TEMP% — o disco enchia (76 GB em um
 * dia de testes). Agora: no Linux (VPS) a mídia entra como link, sem cópia;
 * o bundle é reaproveitado por todos os renders do processo e apagado quando
 * ele termina; cópias esquecidas por processos mortos são limpas na subida.
 */

const ENTRY_POINT = path.join(repoRoot, "packages", "video", "src", "index.ts");
/** Pastas temporárias do Remotion sem dono conhecido e mais velhas que isso não estão em uso */
const STALE_MS = 2 * 60 * 60 * 1000;
/** Marca do processo dono dentro do bundle: órfão (dono morto) é apagado na hora */
const OWNER_FILE = ".vision-owner";

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = existe, só não é nosso
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

let current: Promise<string> | null = null;
let currentDir: string | null = null;

function removeCurrent(): void {
  if (!currentDir) return;
  try {
    fs.rmSync(currentDir, { recursive: true, force: true });
  } catch {
    // já foi (ou o SO segura um arquivo): a limpeza da próxima subida pega
  }
  currentDir = null;
  current = null;
}

/** Usos pontuais (CLI motion-sheet/render): apagar o bundle no `finally` */
export async function releaseBundle(): Promise<void> {
  if (current) await current.catch(() => undefined);
  removeCurrent();
}

/**
 * Servidor: bundle uma vez só na subida (recomendação do Remotion). Em
 * produção o código das composições não muda: um bundle para a vida do
 * processo. O primeiro render não espera; falha aqui só é tentada de novo
 * no render.
 */
export function warmBundle(): void {
  // Windows em dev: o Remotion copia media/ (GBs) e o tsx watch reinicia a cada
  // edição; lá o bundle fica para o primeiro render. VPS (Linux/produção): na subida.
  if (process.env.NODE_ENV !== "production" && process.platform === "win32") return;
  const t0 = Date.now();
  getServeUrl()
    .then(() => console.log(`Remotion: bundle pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s`))
    .catch((err) => console.error("Remotion: bundle falhou (tenta de novo no render):", err instanceof Error ? err.message : err));
  // Chrome do render (Chrome Headless Shell): baixa na subida, não no 1º render do editor
  ensureBrowser()
    .then(() => console.log("Remotion: navegador do render pronto"))
    .catch((err) => console.error("Remotion: navegador do render indisponível:", err instanceof Error ? err.message : err));
}

let hooked = false;
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  process.once("exit", removeCurrent);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      removeCurrent();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

export function getServeUrl(): Promise<string> {
  if (!current) {
    hookExit();
    current = bundle({
      entryPoint: ENTRY_POINT,
      publicDir: mediaDir,
      // Linux: link para media/ em vez de copiar GBs (no Windows o Remotion sempre copia)
      symlinkPublicDir: true,
    })
      .then((dir) => {
        currentDir = dir;
        try {
          fs.writeFileSync(path.join(dir, OWNER_FILE), String(process.pid));
        } catch {
          // sem a marca, a limpeza cai na regra de idade
        }
        return dir;
      })
      .catch((err) => {
        current = null;
        throw err;
      });
  }
  return current;
}

/**
 * Windows: o Remotion COPIA media/ para o bundle quando ele nasce, então um
 * arquivo criado depois (imagem gerada, clipe enviado, áudio tratado) não
 * existe na cópia e o render trava esperando por ele. Antes de cada render,
 * copia para o bundle os arquivos da receita que faltam ou mudaram. No Linux
 * a pasta pública é um link para media/ e nada é preciso. Devolve quantos copiou.
 */
export function syncBundleMedia(serveUrl: string, files: string[]): number {
  const pub = path.join(serveUrl, "public");
  try {
    if (fs.lstatSync(pub).isSymbolicLink()) return 0;
  } catch {
    return 0;
  }
  let copied = 0;
  for (const rel of files) {
    if (!rel.startsWith("media/")) continue;
    const src = path.join(repoRoot, ...rel.split("/"));
    const dst = path.join(pub, ...rel.slice("media/".length).split("/"));
    let s: fs.Stats;
    try {
      s = fs.statSync(src);
    } catch {
      continue; // não existe na origem: o componente decide (pula ou falha)
    }
    try {
      const d = fs.statSync(dst);
      if (d.size === s.size && d.mtimeMs >= s.mtimeMs) continue;
    } catch {
      // falta no bundle
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }
  return copied;
}

/** Tamanho de uma pasta sem seguir links (no Linux o bundle aponta para media/) */
function dirBytes(p: string): number {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // sumiu no meio
        }
      }
    }
  }
  return total;
}

/**
 * Apaga bundles e pastas de assets do Remotion largados por processos antigos
 * (mais velhos que 2 h; o bundle em uso deste processo nunca). Roda na subida
 * do servidor e no comando `retention`.
 */
export function cleanupStaleRemotionTemp(
  { dryRun = false, now = Date.now() }: { dryRun?: boolean; now?: number } = {}
): { removed: number; bytes: number } {
  const tmp = os.tmpdir();
  let removed = 0;
  let bytes = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(tmp);
  } catch {
    return { removed, bytes };
  }
  for (const name of names) {
    if (!/^remotion-webpack-bundle-|^remotion-v[\d.]+-assets/.test(name)) continue;
    const full = path.join(tmp, name);
    if (full === currentDir) continue;
    try {
      const owner = Number(fs.readFileSync(path.join(full, OWNER_FILE), "utf8").trim() || NaN);
      if (Number.isFinite(owner)) {
        // bundle de outro processo vivo (ex.: um render pela CLI agora): não mexe
        if (owner !== process.pid && processAlive(owner)) continue;
      } else if (now - fs.statSync(full).mtimeMs < STALE_MS) continue;
    } catch {
      // sem marca (assets do renderer, versões antigas): só pela idade
      try {
        if (now - fs.statSync(full).mtimeMs < STALE_MS) continue;
      } catch {
        continue;
      }
    }
    try {
      bytes += dirBytes(full);
      if (!dryRun) fs.rmSync(full, { recursive: true, force: true });
      removed++;
    } catch {
      // em uso ou sem permissão: fica para a próxima
    }
  }
  return { removed, bytes };
}

/** Folga mínima de disco para começar um render (bundle no Windows copia media/ inteira) */
export const MIN_FREE_BYTES = 3 * 1024 ** 3;

/** Espaço livre no disco da pasta temporária (onde o Remotion trabalha); null se não der para medir */
export function freeTempBytes(): number | null {
  try {
    const s = fs.statfsSync(os.tmpdir());
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}
