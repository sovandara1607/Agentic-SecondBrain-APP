import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * Material Symbols icon, self-hosted via the `material-symbols` package
 * (app.globals.css imports outlined.css - no CDN, no network font
 * fetch). Deliberately not a component-per-icon like lucide-react: a
 * Material Symbol is one variable font glyph selected by ligature name,
 * so a single generic component covers all of them.
 *
 * `size` sets font-size directly (Material Symbols are font glyphs, not
 * SVGs - a Tailwind `size-*`/`w-*`/`h-*` utility on its own has no effect
 * on glyph size). Pass one of lucide's old size-class equivalents:
 * 12 (size-3), 14 (size-3.5), 16 (size-4), 20 (size-5), 24 (size-6).
 */
export function Icon({
  name,
  className,
  size = 20,
  filled = false,
  weight = 400,
  style,
}: {
  name: string;
  className?: string;
  size?: number;
  filled?: boolean;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      translate="no"
      className={cn(
        "material-symbols-outlined inline-block shrink-0 select-none leading-none align-middle",
        className,
      )}
      style={{
        fontSize: size,
        width: size,
        height: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}
