import type { PlayerRef } from "@remotion/player";
import React, { useEffect, useState } from "react";
import { Icon } from "./Icon";

/** Timecode MM:SS:FF (minutos, segundos, frame), como no After Effects */
export function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const totalSec = Math.floor(f / fps);
  const ff = f - totalSec * fps;
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec - mm * 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}:${pad(ff)}`;
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
      if (now - last < 80) return;
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

  const seekTo = (target: number) => {
    const player = playerRef.current;
    if (!player) return;
    const f = Math.min(Math.max(target, 0), durationInFrames - 1);
    player.seekTo(f);
    setFrame(f);
  };
  const current = () => playerRef.current?.getCurrentFrame() ?? frame;

  return (
    <div className="transport">
      <div>
        <span className="timecode">{timecode(frame, fps)}</span>
        <span className="timecode-total">{timecode(durationInFrames, fps)}</span>
      </div>
      <div className="transport-buttons">
        <button title="Início (Home)" onClick={() => seekTo(0)}>
          <Icon name="skipStart" size={16} />
        </button>
        <button title="Frame anterior (←) · Shift+← volta 1s" onClick={() => seekTo(current() - 1)}>
          <Icon name="stepBack" size={18} />
        </button>
        <button
          className="play-btn"
          title="Play/Pause (espaço)"
          onClick={() => playerRef.current?.toggle()}
        >
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <button title="Próximo frame (→) · Shift+→ avança 1s" onClick={() => seekTo(current() + 1)}>
          <Icon name="stepForward" size={18} />
        </button>
        <button title="Fim (End)" onClick={() => seekTo(durationInFrames - 1)}>
          <Icon name="skipEnd" size={16} />
        </button>
      </div>
      <div className="transport-right">
        <span>{fps} fps</span>
      </div>
    </div>
  );
};
