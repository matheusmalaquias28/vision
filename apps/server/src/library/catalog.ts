import fs from "node:fs";
import path from "node:path";
import { CatalogSchema, emptyCatalog, type Catalog } from "@vision/recipe";
import { mediaDir } from "../paths";

export const libraryDir = path.join(mediaDir, "library");
export const catalogPath = path.join(libraryDir, "catalog.json");

export function loadCatalog(): Catalog {
  if (!fs.existsSync(catalogPath)) return emptyCatalog();
  return CatalogSchema.parse(JSON.parse(fs.readFileSync(catalogPath, "utf8")));
}

/** Grava via arquivo temporário + rename: nunca deixa um catalog.json pela metade */
export function saveCatalog(catalog: Catalog): void {
  fs.mkdirSync(libraryDir, { recursive: true });
  const tmp = `${catalogPath}.tmp`;
  // sem BOM (ver CLAUDE.md)
  fs.writeFileSync(tmp, JSON.stringify(CatalogSchema.parse(catalog), null, 2), "utf8");
  fs.renameSync(tmp, catalogPath);
}
