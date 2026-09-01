import { staticFile } from "remotion";

/**
 * Caminhos na receita são relativos à raiz do repo ("media/...").
 * O diretório "media/" é servido como raiz estática tanto no render
 * (publicDir do bundle) quanto no preview web, então removemos o prefixo.
 */
export function mediaSrc(recipeRelPath: string): string {
  return staticFile(recipeRelPath.replace(/^media\//, ""));
}
