// Íconos de la app (24 × 24, Material). Como string para el visor (DOM a mano) y como componente para React.
const PATHS = {
  download: "M11 4h2v8.2l3.6-3.6L18 10l-6 6-6-6 1.4-1.4L11 12.2zM5 18h14v2H5z",
  tv: "M3 5h18v11H3zm2 2v7h14V7zM8 19h8v2H8z",
  trash: "M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z",
  heart:
    "M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4 6.4 4 8.6 4 10.4 5.3 12 7.2 13.6 5.3 15.4 4 17.6 4 21.7 4 23.6 8.4 22 11.7 19.5 16.4 12 21 12 21z",
  share:
    "M18 16c-.8 0-1.5.3-2 .8l-7-4.1a3 3 0 0 0 0-1.4l7-4.1A3 3 0 1 0 15 5c0 .2 0 .5.1.7l-7 4.1a3 3 0 1 0 0 4.4l7 4.1-.1.7a3 3 0 1 0 3-3z",
  select:
    "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-9 14-5-5 1.4-1.4 3.6 3.6 7.6-7.6L19 8z",
  edit: "M3 17.3V21h3.8L17.8 9.9l-3.7-3.7zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7z",
  place: "M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z",
  merge: "M17 20.4 18.4 19 15 15.6 13.6 17zM7.5 8H11v5.6L5.6 19 7 20.4l6-6V8h3.5L12 3.5z",
  split: "M14 4l2.3 2.3-2.9 2.9 1.4 1.4 2.9-2.9L20 10V4zm-4 0H4v6l2.3-2.3 4.7 4.7V20h2v-8.4L7.7 6.3z",
} as const;

export type IconName = keyof typeof PATHS;

export const iconSvg = (name: IconName, size = 26) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${PATHS[name]}"/></svg>`;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d={PATHS[name]} />
    </svg>
  );
}
