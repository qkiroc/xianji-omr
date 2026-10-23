import type { CSSProperties } from "react";
const paths = {
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  crop: "M7 3v14h14M3 7h14v14M17 3v4M3 17h4",
  locate: "M3 7V3h4m10 0h4v4M3 17v4h4m10 0h4v-4M8 8h8v8H8z",
  folder: "M3 7V5h6l2 2h10v13H3V7Z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
} as const;
export function Icon({
  name,
  style,
}: {
  name: keyof typeof paths;
  style?: CSSProperties;
}) {
  return (
    <svg
      style={style}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
