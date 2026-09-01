import type { Segment, SuggestedCut } from "./schema";

// Segmentos menores que isso são descartados ao aplicar um corte
const MIN_SEGMENT_SECONDS = 0.05;

export interface SourceTime {
  sourceId: string;
  seconds: number;
}

export function segmentDuration(s: Segment): number {
  return s.sourceEnd - s.sourceStart;
}

export function outputDuration(segments: Segment[]): number {
  return segments.reduce((acc, s) => acc + segmentDuration(s), 0);
}

/**
 * Converte um instante do vídeo final para a fonte e o instante
 * correspondentes no clipe bruto. Retorna null se estiver além do fim.
 */
export function outputToSource(
  segments: Segment[],
  outputTime: number
): SourceTime | null {
  if (outputTime < 0) return null;
  let acc = 0;
  for (const s of segments) {
    const dur = segmentDuration(s);
    if (outputTime < acc + dur) {
      return { sourceId: s.sourceId, seconds: s.sourceStart + (outputTime - acc) };
    }
    acc += dur;
  }
  return null;
}

/**
 * Converte um instante de um clipe bruto para o instante no vídeo final.
 * Se o trecho aparece mais de uma vez, retorna a primeira ocorrência.
 * Retorna null se o instante caiu numa parte cortada.
 */
export function sourceToOutput(
  segments: Segment[],
  sourceId: string,
  sourceTime: number
): number | null {
  let acc = 0;
  for (const s of segments) {
    if (
      s.sourceId === sourceId &&
      sourceTime >= s.sourceStart &&
      sourceTime < s.sourceEnd
    ) {
      return acc + (sourceTime - s.sourceStart);
    }
    acc += segmentDuration(s);
  }
  return null;
}

/**
 * Remove o intervalo [cutStart, cutEnd] de um clipe específico,
 * dividindo segmentos quando o corte cai no meio de um.
 */
export function applyCutToSegments(
  segments: Segment[],
  sourceId: string,
  cutStart: number,
  cutEnd: number
): Segment[] {
  const result: Segment[] = [];
  for (const s of segments) {
    if (
      s.sourceId !== sourceId ||
      cutEnd <= s.sourceStart ||
      cutStart >= s.sourceEnd
    ) {
      result.push(s);
      continue;
    }
    const left: Segment = {
      ...s,
      sourceEnd: Math.min(cutStart, s.sourceEnd),
    };
    const right: Segment = {
      ...s,
      id: `${s.id}b`,
      sourceStart: Math.max(cutEnd, s.sourceStart),
    };
    const keepLeft = segmentDuration(left) >= MIN_SEGMENT_SECONDS;
    const keepRight = segmentDuration(right) >= MIN_SEGMENT_SECONDS;
    if (keepLeft) result.push(left);
    if (keepRight) result.push(!keepLeft ? { ...right, id: s.id } : right);
  }
  return result;
}

export function applyAcceptedCut(
  segments: Segment[],
  cut: Pick<SuggestedCut, "sourceId" | "sourceStart" | "sourceEnd">
): Segment[] {
  return applyCutToSegments(segments, cut.sourceId, cut.sourceStart, cut.sourceEnd);
}
