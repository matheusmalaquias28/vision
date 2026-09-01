import { applyAcceptedCut, type Recipe } from "@vision/recipe";

export function acceptCuts(recipe: Recipe, ids: string[]): Recipe {
  let segments = recipe.timeline.segments;
  const suggestions = recipe.timeline.suggestedCuts.map((cut) => {
    if (!ids.includes(cut.id)) return cut;
    if (cut.status !== "pending") {
      throw new Error(`Sugestão ${cut.id} já foi revisada (${cut.status})`);
    }
    segments = applyAcceptedCut(segments, cut);
    return { ...cut, status: "accepted" as const };
  });
  const missing = ids.filter(
    (id) => !recipe.timeline.suggestedCuts.some((c) => c.id === id)
  );
  if (missing.length > 0) {
    throw new Error(`Sugestões não encontradas: ${missing.join(", ")}`);
  }
  if (segments.length === 0) {
    throw new Error(
      "Aceitar esses cortes removeria o vídeo inteiro; operação cancelada"
    );
  }
  return {
    ...recipe,
    timeline: { segments, suggestedCuts: suggestions },
  };
}

export function rejectCuts(recipe: Recipe, ids: string[]): Recipe {
  const missing = ids.filter(
    (id) => !recipe.timeline.suggestedCuts.some((c) => c.id === id)
  );
  if (missing.length > 0) {
    throw new Error(`Sugestões não encontradas: ${missing.join(", ")}`);
  }
  return {
    ...recipe,
    timeline: {
      ...recipe.timeline,
      suggestedCuts: recipe.timeline.suggestedCuts.map((cut) =>
        ids.includes(cut.id) && cut.status === "pending"
          ? { ...cut, status: "rejected" as const }
          : cut
      ),
    },
  };
}

export function pendingCutIds(recipe: Recipe): string[] {
  return recipe.timeline.suggestedCuts
    .filter((c) => c.status === "pending")
    .map((c) => c.id);
}
