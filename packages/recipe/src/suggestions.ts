import type { CutReason, Recipe, SuggestedCut } from "./schema";
import { applyAcceptedCut, isSourceTimeKept } from "./time";
import type { CutCandidate } from "./transcript";

export const CUT_REASON_LABEL: Record<CutReason, string> = {
  silence: "Silêncio",
  pause: "Pausa",
  filler: "Vício",
  repeat: "Repetição",
  retake: "Retomada",
};

const ID_PREFIX: Record<CutReason, string> = {
  silence: "sug",
  pause: "pau",
  filler: "fil",
  repeat: "rep",
  retake: "rtk",
};

/** Ordem de prioridade quando candidatos se sobrepõem (o maior/mais certo vence) */
const PRIORITY: CutReason[] = ["retake", "repeat", "filler", "silence", "pause"];

type Range = Pick<SuggestedCut, "sourceId" | "sourceStart" | "sourceEnd">;

/** Fração do menor intervalo coberta pela interseção (0 = disjuntos) */
function overlapRatio(a: Range, b: Range): number {
  if (a.sourceId !== b.sourceId) return 0;
  const inter =
    Math.min(a.sourceEnd, b.sourceEnd) - Math.max(a.sourceStart, b.sourceStart);
  if (inter <= 0) return 0;
  const smaller = Math.min(a.sourceEnd - a.sourceStart, b.sourceEnd - b.sourceStart);
  return smaller > 0 ? inter / smaller : 1;
}

/**
 * Substitui as sugestões PENDENTES dos motivos em `reasons` pelos candidatos
 * desses mesmos motivos (candidatos de outros motivos são ignorados).
 * Sugestões já revisadas (aceitas/rejeitadas) são preservadas e bloqueiam
 * candidatos sobre o mesmo trecho — o que o operador rejeitou não volta.
 * Candidatos sobre trechos já cortados são descartados.
 */
export function mergeSuggestions(
  recipe: Recipe,
  candidates: CutCandidate[],
  reasons: CutReason[]
): Recipe {
  const kept = recipe.timeline.suggestedCuts.filter(
    (c) => !(c.status === "pending" && reasons.includes(c.reason))
  );
  const taken = new Set(kept.map((c) => c.id));
  const counters = new Map<CutReason, number>();
  const nextId = (reason: CutReason) => {
    let n = counters.get(reason) ?? 0;
    let id: string;
    do {
      n++;
      id = `${ID_PREFIX[reason]}_${String(n).padStart(2, "0")}`;
    } while (taken.has(id));
    counters.set(reason, n);
    taken.add(id);
    return id;
  };

  const segments = recipe.timeline.segments;
  const ordered = candidates
    .filter((c) => reasons.includes(c.reason))
    .sort(
      (a, b) =>
        PRIORITY.indexOf(a.reason) - PRIORITY.indexOf(b.reason) ||
        b.confidence - a.confidence
    );
  const chosen: CutCandidate[] = [];
  for (const c of ordered) {
    if (c.sourceEnd - c.sourceStart <= 0) continue;
    const mid = (c.sourceStart + c.sourceEnd) / 2;
    if (!isSourceTimeKept(segments, c.sourceId, mid)) continue;
    if ([...kept, ...chosen].some((o) => overlapRatio(o, c) >= 0.5)) continue;
    chosen.push(c);
  }
  const byTime = (a: Range, b: Range) =>
    a.sourceId.localeCompare(b.sourceId) || a.sourceStart - b.sourceStart;
  // ids numerados em ordem de tempo (a escolha acima é por prioridade)
  const added: SuggestedCut[] = chosen.sort(byTime).map((c) => ({
    id: nextId(c.reason),
    sourceId: c.sourceId,
    sourceStart: c.sourceStart,
    sourceEnd: c.sourceEnd,
    reason: c.reason,
    confidence: Math.round(c.confidence * 100) / 100,
    status: "pending" as const,
    note: c.note,
  }));
  const suggestedCuts = [...kept, ...added].sort(byTime);
  return { ...recipe, timeline: { ...recipe.timeline, suggestedCuts } };
}

/**
 * Aceita (aplica o corte) ou rejeita sugestões pendentes. Nunca deixa a
 * timeline vazia: um corte que removeria tudo é ignorado e fica pendente.
 */
export function reviewSuggestions(
  recipe: Recipe,
  ids: string[],
  accept: boolean
): Recipe {
  let segments = recipe.timeline.segments;
  const reviewed = new Set<string>();
  for (const cut of recipe.timeline.suggestedCuts) {
    if (!ids.includes(cut.id) || cut.status !== "pending") continue;
    if (accept) {
      const next = applyAcceptedCut(segments, cut);
      if (next.length === 0) continue;
      segments = next;
    }
    reviewed.add(cut.id);
  }
  const status = accept ? ("accepted" as const) : ("rejected" as const);
  return {
    ...recipe,
    timeline: {
      segments,
      suggestedCuts: recipe.timeline.suggestedCuts.map((c) =>
        reviewed.has(c.id) ? { ...c, status } : c
      ),
    },
  };
}
