import React from "react";

/**
 * Ícones SVG inline: grade 24, traço 1.75 em currentColor, cantos
 * arredondados. Um único estilo para a interface inteira.
 */
export type IconName =
  | "play"
  | "pause"
  | "skipStart"
  | "skipEnd"
  | "stepBack"
  | "stepForward"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "chevronUp"
  | "check"
  | "x"
  | "plus"
  | "music"
  | "rewind"
  | "forward"
  | "scissors"
  | "undo"
  | "redo"
  | "sparkles"
  | "film"
  | "captions"
  | "layers"
  | "volume"
  | "export"
  | "folder"
  | "upload"
  | "text"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "wand"
  | "eye"
  | "eyeOff"
  | "trash"
  | "anchor"
  | "mic"
  | "home"
  | "save"
  | "pointer"
  | "copy"
  | "search"
  | "external"
  | "user"
  | "calendar"
  | "cloud"
  | "board"
  | "refresh"
  | "bell"
  | "chat";

const PATHS: Record<IconName, React.ReactNode> = {
  bell: (
    <>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  chat: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />,
  external: (
    <>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5L11 13" />
      <path d="M17.5 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 6 6.5h4.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c.8-3.3 3.6-5 7-5s6.2 1.7 7 5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  cloud: (
    <>
      <path d="M7.5 18.5a4 4 0 0 1-.6-7.95 5.5 5.5 0 0 1 10.6 1.45 3.25 3.25 0 0 1-.5 6.5z" />
      <path d="M12 16v-5M9.75 13.25L12 11l2.25 2.25" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.25 4.5v15M15 4.5v9" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9" />
      <path d="M4.5 12a7.5 7.5 0 0 1 13.2-4.9" />
      <path d="M18 3.5v4h-4M6 20.5v-4h4" />
    </>
  ),
  play: <path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L8.7 4.5a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  skipStart: (
    <>
      <path d="M6 5v14" />
      <path d="M18 6.2v11.6a.7.7 0 0 1-1.1.6L9.4 12.6a.7.7 0 0 1 0-1.2l7.5-5.8a.7.7 0 0 1 1.1.6z" fill="currentColor" stroke="none" />
    </>
  ),
  skipEnd: (
    <>
      <path d="M18 5v14" />
      <path d="M6 6.2v11.6a.7.7 0 0 0 1.1.6l7.5-5.8a.7.7 0 0 0 0-1.2L7.1 5.6a.7.7 0 0 0-1.1.6z" fill="currentColor" stroke="none" />
    </>
  ),
  stepBack: <path d="M14.5 6.5L9 12l5.5 5.5" />,
  stepForward: <path d="M9.5 6.5L15 12l-5.5 5.5" />,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  check: <path d="M20 6.5L9.5 17 4 11.5" />,
  x: <path d="M17.5 6.5l-11 11M6.5 6.5l11 11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  music: (
    <>
      <path d="M9 18V5.5l11-2V16" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  rewind: <path d="M11 18l-6-6 6-6M19 18l-6-6 6-6" />,
  forward: <path d="M13 18l6-6-6-6M5 18l6-6-6-6" />,
  scissors: (
    <>
      <circle cx="6" cy="6.5" r="2.75" />
      <circle cx="6" cy="17.5" r="2.75" />
      <path d="M20 4.5L8.2 15.6M14.6 14.3L20 19.5M8.2 8.4L12 12" />
    </>
  ),
  undo: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  sparkles: (
    <>
      <path d="M11 3.5l1.7 4.3 4.3 1.7-4.3 1.7L11 15.5l-1.7-4.3L5 9.5l4.3-1.7z" />
      <path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  film: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 11h4M13 11h4M7 15h7M16 15h1" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.5L12 21l8.5-4.5" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  export: (
    <>
      <path d="M12 15V3.5M7.5 8L12 3.5 16.5 8" />
      <path d="M4.5 14v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" />
    </>
  ),
  folder: <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  upload: (
    <>
      <path d="M12 16V5M7.5 9.5L12 5l4.5 4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  text: <path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" />,
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5M10.5 8v5" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5" />
    </>
  ),
  fit: <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />,
  wand: (
    <>
      <path d="M4 20L15 9M13 7l4 4" />
      <path d="M18 3v3M16.5 4.5h3M20 9.5v2M19 10.5h2M9.5 3.5v2M8.5 4.5h2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10 5.8a9 9 0 0 1 2-.3c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.4 3.2M6.6 6.9C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1" />
      <path d="M4 4l16 16" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />,
  anchor: (
    <>
      <circle cx="12" cy="5.5" r="2" />
      <path d="M12 7.5v13M8 11h8M4.5 13.5a7.5 7.5 0 0 0 15 0" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  home: <path d="M4 11l8-6.5 8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M8 4v4.5h7V4M8 20v-6h8v6" />
    </>
  ),
  pointer: <path d="M6 3.5l12.5 7.6-5.6 1.3-2.6 5.4z" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 16, className }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ display: "block", flexShrink: 0 }}
  >
    {PATHS[name]}
  </svg>
);
