import { Player } from "@remotion/player";
import {
  LAB_DEMOS,
  LAB_FPS,
  MotionLabComposition,
  type LabDemo,
  type LabDemoId,
  type LabWord,
  type MotionLabProps,
} from "@vision/video";
import React, { useEffect, useMemo, useState } from "react";
import { getRecipe } from "../api";
import { Icon } from "../editor/Icon";
import { Segmented } from "../ui/controls";
import { Logo } from "../ui/Logo";
import "./lab.css";

/** Projeto cujos trechos de fala os protótipos usam (janelas fixas em MotionLab.tsx) */
const LAB_PROJECT = "teste-cortes";

const LabCard: React.FC<{
  demo: LabDemo;
  file: string;
  words: LabWord[];
  active: boolean;
  onActivate: () => void;
}> = ({ demo, file, words, active, onActivate }) => {
  const [variant, setVariant] = useState(demo.variants[0].id);
  // identidade estável: o Player reinicia se inputProps mudar a cada render
  const inputProps = useMemo<MotionLabProps>(
    () => ({ demo: demo.id, variant, file, words }),
    [demo.id, variant, file, words]
  );
  return (
    <article className={`lab-card ${active ? "active" : ""}`}>
      <header className="lab-card-head">
        <h3>{demo.title}</h3>
        <p>{demo.description}</p>
        <p className="lab-moment">{demo.moment}</p>
      </header>
      <div className="lab-player">
        {active ? (
          <Player
            component={MotionLabComposition}
            inputProps={inputProps}
            durationInFrames={demo.durationInFrames(variant)}
            fps={LAB_FPS}
            compositionWidth={1080}
            compositionHeight={1920}
            controls
            loop
            autoPlay
            clickToPlay
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          // só um player por vez: vários <video> do mesmo bruto travam o buffer
          <button
            className="lab-poster"
            style={{ backgroundImage: `url(/api/projects/${LAB_PROJECT}/thumbnail)` }}
            onClick={onActivate}
          >
            <span className="lab-poster-play">
              <Icon name="play" size={22} />
            </span>
          </button>
        )}
      </div>
      <Segmented
        value={variant}
        size="sm"
        options={demo.variants.map((v) => ({ value: v.id, label: v.label }))}
        onChange={(v) => {
          setVariant(v);
          onActivate();
        }}
      />
    </article>
  );
};

/**
 * Laboratório: os protótipos de motion rodando sobre um vídeo real, para o
 * operador escolher o que entra na biblioteca. Não altera nenhum projeto.
 */
export const MotionLabPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [source, setSource] = useState<{ file: string; words: LabWord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<LabDemoId | null>(null);

  useEffect(() => {
    getRecipe(LAB_PROJECT)
      .then((r) =>
        setSource({
          file: r.sources[0].file,
          words: r.captions.blocks
            .filter((b) => b.sourceId === r.sources[0].id)
            .flatMap((b) => b.words.map((w) => ({ text: w.text, start: w.start, end: w.end }))),
        })
      )
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="lab">
      <header className="topbar">
        <button className="brand" title="Voltar à tela inicial" onClick={onBack}>
          <Logo />
        </button>
        <span className="topbar-sep" />
        <span className="lab-title">Laboratório de motions</span>
      </header>
      <div className="lab-body">
        <p className="lab-intro">
          Protótipos rodando sobre <strong>{LAB_PROJECT}</strong>. Clique num card para tocar, troque
          as variantes e escolha o que deve entrar na biblioteca de motions. Nada aqui altera seus
          projetos.
        </p>
        {error ? (
          <p className="lab-error">
            Não consegui abrir o projeto <strong>{LAB_PROJECT}</strong> ({error}). Os protótipos usam
            trechos fixos da fala desse vídeo.
          </p>
        ) : !source ? (
          <p className="lab-intro">Carregando…</p>
        ) : (
          <div className="lab-grid">
            {LAB_DEMOS.map((d) => (
              <LabCard
                key={d.id}
                demo={d}
                file={source.file}
                words={source.words}
                active={active === d.id}
                onActivate={() => setActive(d.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
