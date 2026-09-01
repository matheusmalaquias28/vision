import type { PlayerRef } from "@remotion/player";
import React, { useEffect, useState } from "react";

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

interface TransportBarProps {
  playerRef: React.RefObject<PlayerRef | null>;
  fps: number;
  durationInFrames: number;
}

/** Controle de reprodução sempre visível (o overlay do Player some sozinho) */
export const TransportBar: React.FC<TransportBarProps> = ({
  playerRef,
  fps,
  durationInFrames,
}) => {
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    let last = 0;
    const onFrame = (e: { detail: { frame: number } }) => {
      const now = performance.now();
      if (now - last < 200) return;
      last = now;
      setFrame(e.detail.frame);
    };
    const onSeek = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onSeek);
    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onSeek);
    };
  }, [playerRef]);

  const seekBy = (deltaSeconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    const target = Math.min(
      Math.max(player.getCurrentFrame() + Math.round(deltaSeconds * fps), 0),
      durationInFrames - 1
    );
    player.seekTo(target);
    setFrame(target);
  };

  return (
    <div className="transport">
      <button title="Voltar ao início" onClick={() => { playerRef.current?.seekTo(0); setFrame(0); }}>
        ⏮
      </button>
      <button title="-1s" onClick={() => seekBy(-1)}>
        -1s
      </button>
      <button
        className="play-btn"
        title="Play/Pause (espaço)"
        onClick={() => playerRef.current?.toggle()}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button title="+1s" onClick={() => seekBy(1)}>
        +1s
      </button>
      <span className="transport-time">
        {fmtTime(frame / fps)} / {fmtTime(durationInFrames / fps)}
      </span>
    </div>
  );
};
