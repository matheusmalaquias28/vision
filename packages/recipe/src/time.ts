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
 * Id novo derivado de `base` que não colide com `taken` (e passa a ocupá-lo).
 * Remove sufixos "b"/"bN" acumulados para não gerar "seg_01bbbb...".
 */
function freshSegmentId(base: string, taken: Set<string>): string {
  const root = base.replace(/(b\d*)+$/, "") || base;
  let id = `${root}b`;
  for (let n = 2; taken.has(id); n++) id = `${root}b${n}`;
  taken.add(id);
  return id;
}

/** O instante de um clipe bruto está presente no vídeo final? */
export function isSourceTimeKept(
  segments: Segment[],
  sourceId: string,
  sourceTime: number
): boolean {
  return sourceToOutput(segments, sourceId, sourceTime) !== null;
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
  const taken = new Set(segments.map((s) => s.id));
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
      sourceStart: Math.max(cutEnd, s.sourceStart),
    };
    const keepLeft = segmentDuration(left) >= MIN_SEGMENT_SECONDS;
    const keepRight = segmentDuration(right) >= MIN_SEGMENT_SECONDS;
    if (keepLeft) result.push(left);
    // sobra direita herda o id quando é a única parte que restou
    if (keepRight) {
      result.push(keepLeft ? { ...right, id: freshSegmentId(s.id, taken) } : right);
    }
  }
  return result;
}

/**
 * Inverso de applyCutToSegments: devolve à timeline o trecho [start, end] de
 * um clipe. Entra logo após o segmento da mesma fonte que começa antes dele
 * (ordem do bruto) e funde com vizinhos da mesma fonte que se tocam —
 * buracos menores que MIN_SEGMENT_SECONDS também são fechados.
 */
export function restoreSourceRange(
  segments: Segment[],
  sourceId: string,
  start: number,
  end: number
): Segment[] {
  const from = Math.max(0, start);
  if (end - from < MIN_SEGMENT_SECONDS) return segments;
  const taken = new Set(segments.map((s) => s.id));
  const restored: Segment = {
    id: freshSegmentId(`${sourceId.replace(/^src_/, "seg_")}`, taken),
    sourceId,
    sourceStart: from,
    sourceEnd: end,
  };
  const sameSource = segments
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.sourceId === sourceId);
  const before = sameSource.filter(({ s }) => s.sourceStart <= from);
  const insertAt =
    before.length > 0
      ? before[before.length - 1].i + 1
      : sameSource.length > 0
        ? sameSource[0].i
        : segments.length;
  const withRestored = [
    ...segments.slice(0, insertAt),
    restored,
    ...segments.slice(insertAt),
  ];
  const merged: Segment[] = [];
  for (const s of withRestored) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.sourceId === s.sourceId &&
      prev.sourceStart <= s.sourceStart &&
      s.sourceStart <= prev.sourceEnd + MIN_SEGMENT_SECONDS
    ) {
      // o segmento original preserva seu id; o restaurado é absorvido
      const keepId = prev === restored ? s.id : prev.id;
      merged[merged.length - 1] = {
        ...prev,
        id: keepId,
        sourceEnd: Math.max(prev.sourceEnd, s.sourceEnd),
      };
      continue;
    }
    merged.push(s);
  }
  return merged;
}

export function applyAcceptedCut(
  segments: Segment[],
  cut: Pick<SuggestedCut, "sourceId" | "sourceStart" | "sourceEnd">
): Segment[] {
  return applyCutToSegments(segments, cut.sourceId, cut.sourceStart, cut.sourceEnd);
}

/**
 * Insere um clipe (segmento próprio) na sequência, no instante do vídeo final
 * `atOutputSeconds`. Se o ponto cai no meio de um segmento, ele é dividido e o
 * clipe entra entre as duas metades (empurra o restante pra frente). Nas bordas
 * (0, fim, ou entre segmentos) apenas insere sem dividir.
 */
export function insertClipSegment(
  segments: Segment[],
  clip: Segment,
  atOutputSeconds: number
): Segment[] {
  const total = outputDuration(segments);
  const at = Math.max(0, Math.min(atOutputSeconds, total));
  const taken = new Set([...segments.map((s) => s.id), clip.id]);
  const result: Segment[] = [];
  let acc = 0;
  let inserted = false;
  for (const s of segments) {
    const dur = segmentDuration(s);
    if (!inserted && at > acc && at < acc + dur) {
      // divide o segmento no ponto de inserção
      const splitRaw = s.sourceStart + (at - acc);
      result.push({ ...s, sourceEnd: splitRaw });
      result.push(clip);
      result.push({ ...s, id: freshSegmentId(s.id, taken), sourceStart: splitRaw });
      inserted = true;
    } else {
      if (!inserted && at <= acc) {
        result.push(clip);
        inserted = true;
      }
      result.push(s);
    }
    acc += dur;
  }
  if (!inserted) result.push(clip); // at no fim (ou timeline vazia) → anexa
  return result;
}

/**
 * Ferramenta de corte: divide o segmento sob `atOutputSeconds` em dois, sem
 * remover nada (o vídeo final não muda; cada metade passa a ser editável).
 * Retorna os segmentos inalterados se o ponto cai numa borda.
 */
export function splitSegmentAt(segments: Segment[], atOutputSeconds: number): Segment[] {
  const taken = new Set(segments.map((s) => s.id));
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const dur = segmentDuration(s);
    const local = atOutputSeconds - acc;
    if (local > MIN_SEGMENT_SECONDS && local < dur - MIN_SEGMENT_SECONDS) {
      const split = Math.round((s.sourceStart + local) * 1000) / 1000;
      return [
        ...segments.slice(0, i),
        { ...s, sourceEnd: split },
        { ...s, id: freshSegmentId(s.id, taken), sourceStart: split },
        ...segments.slice(i + 1),
      ];
    }
    acc += dur;
  }
  return segments;
}

/** Duplica o segmento: a cópia entra logo depois do original */
export function duplicateSegment(segments: Segment[], segmentId: string): Segment[] {
  const i = segments.findIndex((s) => s.id === segmentId);
  if (i < 0) return segments;
  const taken = new Set(segments.map((s) => s.id));
  const copy = { ...segments[i], id: freshSegmentId(segments[i].id, taken) };
  return [...segments.slice(0, i + 1), copy, ...segments.slice(i + 1)];
}
