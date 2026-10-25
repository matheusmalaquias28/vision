import { type Motion, type Recipe, type SourceTime } from "@vision/recipe";
import React, { useCallback, useEffect, useState } from "react";
import {
  deleteIllustrationApi,
  generateIllustrationApi,
  listIllustrationsApi,
  mediaUrl,
  type IllustrationList,
} from "../api";
import { Icon } from "./Icon";
import { insertMotion } from "./MotionPanel";

/**
 * Controle das imagens geradas no projeto: tudo o que já foi gerado (e pago)
 * fica aqui para reaproveitar sem gastar crédito — inserir no playhead, trocar
 * a imagem da ilustração selecionada, gerar uma variação ou apagar as que não
 * estão em uso. Mostra quanto do teto de gerações do projeto já foi usado.
 */
export const IllustrationGallery: React.FC<{
  recipe: Recipe;
  selected: Motion | undefined;
  playheadSource: SourceTime | null;
  /** Muda quando outra parte do editor gerou imagem (recarrega a lista) */
  version: number;
  onChange: (recipe: Recipe) => void;
  onSelect: (id: string | null) => void;
}> = ({ recipe, selected, playheadSource, version, onChange, onSelect }) => {
  const projectId = recipe.projectId;
  const [list, setList] = useState<IllustrationList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");

  const load = useCallback(() => {
    listIllustrationsApi(projectId)
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [projectId]);
  useEffect(load, [load, version]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Imagens usadas por motions da receita ATUAL (inclusive não salva) */
  const usedBy = new Map<string, Motion>();
  for (const m of recipe.motions) {
    if (m.kind === "illustration" && m.params.image && m.status !== "rejected") usedBy.set(m.params.image, m);
  }
  const selectedIllus = selected?.kind === "illustration" ? selected : null;

  const insertAt = (file: string, text: string) => {
    if (!playheadSource) return;
    const out = insertMotion(recipe, "illustration", playheadSource);
    onChange({
      ...out.recipe,
      motions: out.recipe.motions.map((m) =>
        m.id === out.id && m.kind === "illustration" ? { ...m, params: { ...m.params, image: file, subject: text } } : m
      ),
    });
    onSelect(out.id);
  };

  const useInSelected = (file: string, text: string) => {
    if (!selectedIllus) return;
    onChange({
      ...recipe,
      motions: recipe.motions.map((m) =>
        m.id === selectedIllus.id && m.kind === "illustration"
          ? ({ ...m, status: m.status === "pending" ? "accepted" : m.status, params: { ...m.params, image: file, subject: text } } as Motion)
          : m
      ),
    });
  };

  if (list && !list.enabled && list.items.length === 0) {
    return <p className="prop-hint">Geração de imagens desligada: falta MAGNIFIC_API_KEY no .env do servidor.</p>;
  }
  const full = list ? list.generated >= list.limit : false;

  return (
    <div className="illus-gallery">
      <div className="illus-gallery-head">
        <strong>Imagens do projeto</strong>
        {list && (
          <span className={`pill ${full ? "warn" : ""}`} title="Inclui variações e as apagadas; o teto evita gasto descontrolado">
            {list.generated} de {list.limit} gerações
          </span>
        )}
      </div>
      <div className="illus-new">
        <input
          value={subject}
          maxLength={300}
          placeholder="Descreva uma imagem para gerar…"
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && subject.trim().length >= 2 && !busy && !full) {
              void run("new", () => generateIllustrationApi(projectId, subject.trim()).then(() => setSubject("")));
            }
          }}
        />
        <button
          className="sm"
          disabled={subject.trim().length < 2 || busy !== null || full}
          title="Gera a imagem (1:1, colagem de papel) e guarda aqui; depois você insere onde quiser"
          onClick={() => run("new", () => generateIllustrationApi(projectId, subject.trim()).then(() => setSubject("")))}
        >
          <Icon name="sparkles" size={13} />
          {busy === "new" ? "Gerando…" : "Gerar"}
        </button>
      </div>
      {error && <span className="illus-error">{error}</span>}
      {list && list.items.length === 0 ? (
        <p className="prop-hint">Nenhuma imagem gerada ainda.</p>
      ) : (
        <div className="illus-grid">
          {list?.items.map((it) => {
            const user = usedBy.get(it.file);
            return (
              <div key={it.file} className={`illus-card ${user ? "used" : ""}`}>
                <button
                  className="illus-card-img"
                  title={user ? "Em uso: clique para selecionar a ilustração" : it.subject}
                  onClick={() => user && onSelect(user.id)}
                >
                  <img src={mediaUrl(it.file)} alt="" loading="lazy" />
                  {user && <span className="illus-badge">em uso</span>}
                </button>
                <span className="illus-card-subject" title={it.subject}>
                  {it.subject}
                </span>
                <div className="illus-card-actions">
                  <button
                    className="sm icon ghost"
                    disabled={!playheadSource}
                    title="Inserir uma ilustração com esta imagem no playhead (sem gastar crédito)"
                    onClick={() => insertAt(it.file, it.subject)}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                  <button
                    className="sm icon ghost"
                    disabled={!selectedIllus || selectedIllus.params.image === it.file}
                    title={selectedIllus ? "Usar esta imagem na ilustração selecionada" : "Selecione uma ilustração para trocar a imagem"}
                    onClick={() => useInSelected(it.file, it.subject)}
                  >
                    <Icon name="refresh" size={13} />
                  </button>
                  <button
                    className="sm icon ghost"
                    disabled={busy !== null || full}
                    title="Gerar uma variação com a mesma descrição (gasta crédito)"
                    onClick={() => run(`var:${it.file}`, () => generateIllustrationApi(projectId, it.subject, true))}
                  >
                    <Icon name="sparkles" size={13} />
                  </button>
                  <button
                    className="sm icon ghost danger"
                    disabled={busy !== null || Boolean(user)}
                    title={user ? "Em uso: remova a ilustração antes" : "Apagar esta imagem do projeto"}
                    onClick={() => run(`del:${it.file}`, () => deleteIllustrationApi(projectId, it.file))}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
                {busy === `var:${it.file}` && <span className="illus-card-busy">Gerando variação…</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
