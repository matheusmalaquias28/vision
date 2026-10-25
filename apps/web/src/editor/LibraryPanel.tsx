import {
  ASSET_TYPE_LABEL,
  MOTION_GALLERY_ORDER,
  searchAssets,
  type Asset,
  type AssetType,
  type Catalog,
} from "@vision/recipe";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getLibrary, mediaUrl } from "../api";
import { useDragScroll } from "../ui/controls";
import { Icon } from "./Icon";

/** Ordem dos filtros; tipos sem item no catálogo não aparecem */
const FILTERS: AssetType[] = [
  "sfx",
  "icon",
  "character",
  "transition",
  "background",
  "overlay",
  "texture",
  "music",
];

const SHORT: Partial<Record<AssetType, string>> = {
  sfx: "SFX",
  icon: "Ícones",
  character: "Personagens",
  transition: "Transições",
  background: "Fundos",
  overlay: "Overlays",
  texture: "Texturas",
  music: "Músicas",
};

const AUDIO_TYPES: AssetType[] = ["sfx", "music"];
/** Tipos que entram na timeline no playhead */
const ADDABLE: AssetType[] = ["sfx", "icon", "character", "background", "transition", "overlay", "texture"];
const PAGE = 120;

function fmtDur(s: number | null): string {
  if (s === null) return "";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, "0")}`;
}

/** Tipo MIME do arrastar-e-soltar biblioteca → timeline (carrega o Asset em JSON) */
export const ASSET_DRAG_TYPE = "application/x-vision-asset";
/** + tipo do asset: o conteúdo só sai no drop, o tipo dá para ler no dragover (trilha de destino) */
export const ASSET_KIND_PREFIX = "application/x-vision-kind-";

/** Filtro aberto na Biblioteca: a galeria de motions ou um tipo de asset */
export type LibraryFilter = "motions" | AssetType;

interface LibraryPanelProps {
  playheadSeconds: number;
  /** Adiciona no playhead (sfx/visuais) ou aplica (música) */
  onAdd: (asset: Asset) => void;
  head: React.ReactNode;
  filter: LibraryFilter;
  onFilterChange: (f: LibraryFilter) => void;
  /** Galeria do Motion Registry, mostrada no filtro "Motions" (não depende do catálogo) */
  motionGallery: React.ReactNode;
}

export const LibraryPanel: React.FC<LibraryPanelProps> = ({ playheadSeconds, onAdd, head, filter, onFilterChange, motionGallery }) => {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const filtersRef = useDragScroll<HTMLDivElement>();
  const type: AssetType | null = filter === "motions" ? null : filter;
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    getLibrary()
      .then(setCatalog)
      .catch((e) => setError(e.message));
    return () => audioRef.current?.pause();
  }, []);

  useEffect(() => setLimit(PAGE), [query, type]);

  const counts = useMemo(() => {
    const m = new Map<AssetType, number>();
    for (const a of catalog?.assets ?? []) m.set(a.type, (m.get(a.type) ?? 0) + 1);
    return m;
  }, [catalog]);

  // filtro escolhido sem itens (catálogo ainda vazio desse tipo): cai no primeiro disponível
  const available = FILTERS.filter((t) => (counts.get(t) ?? 0) > 0);
  useEffect(() => {
    if (type !== null && available.length > 0 && !available.includes(type)) onFilterChange(available[0]);
  }, [available.join(), type]);

  const results = useMemo(
    () => (catalog && type ? searchAssets(catalog.assets, query, [type]) : []),
    [catalog, query, type]
  );

  const togglePlay = (a: Asset) => {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    if (playing === a.id) {
      audio.pause();
      setPlaying(null);
      return;
    }
    audio.src = mediaUrl(a.file);
    audio.currentTime = 0;
    audio.onended = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
    setPlaying(a.id);
  };

  const isAudio = type !== null && AUDIO_TYPES.includes(type);
  const shown = results.slice(0, limit);

  return (
    <section className="dock library-dock">
      {head}
      {type !== null && (
      <div className="lib-search">
        <Icon name="search" size={14} className="lib-search-icon" />
        <input
          placeholder="Buscar: whoosh, dinheiro, raiva, film burn…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      )}
      <div className="lib-filters" ref={filtersRef}>
        <button
          className={`chip ${filter === "motions" ? "on" : ""}`}
          title="Motions e receitas com prévia; entram no playhead"
          onClick={() => {
            onFilterChange("motions");
            setSelected(null);
          }}
        >
          Motions
          <span className="chip-count">{MOTION_GALLERY_ORDER.length}</span>
        </button>
        {FILTERS.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => (
          <button
            key={t}
            className={`chip ${t === type ? "on" : ""}`}
            onClick={() => {
              onFilterChange(t);
              setSelected(null);
            }}
          >
            {SHORT[t] ?? ASSET_TYPE_LABEL[t]}
            <span className="chip-count">{counts.get(t)}</span>
          </button>
        ))}
      </div>

      <div className="dock-body lib-body">
        {type === null ? (
          motionGallery
        ) : error ? (
          <p className="empty-hint error">{error}</p>
        ) : !catalog ? (
          <p className="empty-hint">Carregando biblioteca…</p>
        ) : catalog.assets.length === 0 ? (
          <p className="empty-hint">
            Biblioteca vazia. Importe um pack com <strong>npm run cli -- library import &lt;pasta&gt;</strong>.
          </p>
        ) : results.length === 0 ? (
          <p className="empty-hint">Nada encontrado para “{query}”.</p>
        ) : isAudio ? (
          <div className="lib-list">
            {shown.map((a) => (
              <div
                key={a.id}
                className={`lib-row ${selected?.id === a.id ? "selected" : ""}`}
                draggable={a.type === "sfx"}
                onDragStart={(e) => dragAsset(e, a)}
                onClick={() => setSelected(a)}
                onDoubleClick={() => onAdd(a)}
                title="Duplo clique adiciona · arraste para a timeline"
              >
                <button
                  className={`sm icon ${playing === a.id ? "primary" : "ghost"}`}
                  title={playing === a.id ? "Parar" : "Ouvir"}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay(a);
                  }}
                >
                  <Icon name={playing === a.id ? "pause" : "play"} size={12} />
                </button>
                <span className="lib-row-name">{a.name}</span>
                {a.license === "verify" && (
                  <span className="pill warn" title="Pode ter direitos autorais de terceiros: confirme antes de usar em vídeo de cliente">
                    licença
                  </span>
                )}
                <span className="lib-row-dur">{fmtDur(a.durationSeconds)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="lib-grid">
            {shown.map((a) => (
              <LibraryTile
                key={a.id}
                asset={a}
                selected={selected?.id === a.id}
                onSelect={() => setSelected(a)}
                onAdd={() => onAdd(a)}
              />
            ))}
          </div>
        )}
        {results.length > limit && (
          <div className="row" style={{ justifyContent: "center", padding: "10px 0 16px" }}>
            <button className="sm" onClick={() => setLimit(limit + PAGE)}>
              Mostrar mais ({results.length - limit})
            </button>
          </div>
        )}
      </div>

      {selected && type !== null && (
        <div className="lib-detail">
          <div className="lib-detail-head">
            <span className="lib-detail-name" title={selected.name}>
              {selected.name}
            </span>
            <button className="sm icon ghost" title="Fechar" onClick={() => setSelected(null)}>
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="lib-detail-meta">
            {ASSET_TYPE_LABEL[selected.type]}
            {selected.collection ? ` · ${selected.collection}` : ""}
            {selected.durationSeconds ? ` · ${fmtDur(selected.durationSeconds)}` : ""}
            {selected.width ? ` · ${selected.width}×${selected.height}` : ""}
            {selected.blend !== "normal" ? ` · mescla ${selected.blend}` : ""}
          </div>
          {selected.description && <p className="note">{selected.description}</p>}
          {selected.tags.length > 0 && (
            <div className="lib-tags">
              {selected.tags.slice(0, 12).map((t) => (
                <button key={t} className="tag" onClick={() => setQuery(t)} title="Buscar por esta tag">
                  {t}
                </button>
              ))}
            </div>
          )}
          {selected.type === "music" ? (
            <button className="primary sm" onClick={() => onAdd(selected)}>
              <Icon name="music" size={13} /> Usar como música de fundo
            </button>
          ) : ADDABLE.includes(selected.type) ? (
            <button className="primary sm" onClick={() => onAdd(selected)}>
              <Icon name="plus" size={13} /> Adicionar em {playheadSeconds.toFixed(1)}s
              {selected.type === "transition" ? " (gruda no corte)" : ""}
            </button>
          ) : (
            <p className="note">
              {selected.type === "font"
                ? "Fontes do pack ainda não entram na legenda (use as do Google Fonts no Estilo)."
                : "Esse tipo ainda não é aplicado direto pelo editor."}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

/** Miniatura; vídeos tocam em loop sem som ao passar o mouse */
function dragAsset(e: React.DragEvent, asset: Asset) {
  e.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(asset));
  e.dataTransfer.setData(`${ASSET_KIND_PREFIX}${asset.type}`, "");
  e.dataTransfer.effectAllowed = "copy";
}

const LibraryTile: React.FC<{
  asset: Asset;
  selected: boolean;
  onSelect: () => void;
  onAdd: () => void;
}> = ({ asset, selected, onSelect, onAdd }) => {
  const [hover, setHover] = useState(false);
  const isVideo = /\.(mp4|webm)$/i.test(asset.file);
  return (
    <button
      className={`lib-tile ${selected ? "selected" : ""} ${asset.hasAlpha ? "alpha" : ""}`}
      title={`${asset.description || asset.name}
Duplo clique adiciona · arraste para a timeline`}
      draggable={ADDABLE.includes(asset.type)}
      onDragStart={(e) => dragAsset(e, asset)}
      onClick={onSelect}
      onDoubleClick={onAdd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && isVideo ? (
        <video src={mediaUrl(asset.file)} autoPlay muted loop playsInline />
      ) : asset.thumb ? (
        <img src={mediaUrl(asset.thumb)} alt="" loading="lazy" />
      ) : (
        <Icon name="layers" size={20} />
      )}
      {asset.durationSeconds && <span className="lib-tile-dur">{fmtDur(asset.durationSeconds)}</span>}
    </button>
  );
};
