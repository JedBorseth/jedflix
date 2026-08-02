/**
 * Jedflix wordmark — bold geometric SVG letters for the startup sequence.
 * Letter nodes expose `data-letter` hooks for the GSAP timeline.
 */

import {
  LETTER_BASELINE_Y,
  LETTER_X,
  STARTUP_LOGO_VIEWBOX,
  TRAILING_LETTERS,
} from "./logoLayout";

type JedflixLogoSvgProps = {
  className?: string;
};

export function JedflixLogoSvg({ className }: JedflixLogoSvgProps) {
  return (
    <svg
      className={className}
      viewBox={STARTUP_LOGO_VIEWBOX}
      role="img"
      aria-label="Jedflix"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="jedflixShineGrad"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="120"
          y2="0"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="40%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffc4c8" stopOpacity="0.78" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        <filter
          id="jedflixSoftGlow"
          x="-35%"
          y="-45%"
          width="170%"
          height="190%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="0.88 0 0 0 0.12
                    0 0.04 0 0 0
                    0 0 0.06 0 0
                    0 0 0 0.5 0"
            result="glow"
          />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter
          id="jedflixBloom"
          x="-70%"
          y="-70%"
          width="240%"
          height="240%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="bloom" />
          <feColorMatrix
            in="bloom"
            type="matrix"
            values="0.8 0 0 0 0.18
                    0 0.02 0 0 0
                    0 0 0.04 0 0
                    0 0 0 0.32 0"
          />
        </filter>

        <mask
          id="jedflixShineMask"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="720"
          height="180"
        >
          <rect width="720" height="180" fill="black" />
          <g fill="white">
            <text
              x={LETTER_X.J}
              y={LETTER_BASELINE_Y}
              textAnchor="middle"
              className="jedflix-glyph"
            >
              J
            </text>
            {TRAILING_LETTERS.map((letter) => (
              <text
                key={`mask-${letter}`}
                x={LETTER_X[letter]}
                y={LETTER_BASELINE_Y}
                textAnchor="middle"
                className="jedflix-glyph"
              >
                {letter}
              </text>
            ))}
          </g>
        </mask>
      </defs>

      <g className="jedflix-bloom" data-startup="bloom" opacity="0" filter="url(#jedflixBloom)" aria-hidden="true">
        <text
          x={LETTER_X.J}
          y={LETTER_BASELINE_Y}
          textAnchor="middle"
          className="jedflix-glyph"
          fill="#E50914"
        >
          J
        </text>
      </g>

      <g className="jedflix-word" data-startup="word" filter="url(#jedflixSoftGlow)">
        <g className="jedflix-letters" fill="#E50914">
          <g className="jedflix-letter jedflix-letter--j" data-startup="letter-j" data-letter="J">
            <text
              x={LETTER_X.J}
              y={LETTER_BASELINE_Y}
              textAnchor="middle"
              className="jedflix-glyph"
            >
              J
            </text>
          </g>

          {TRAILING_LETTERS.map((letter) => (
            <g
              key={letter}
              className={`jedflix-letter jedflix-letter--${letter}`}
              data-startup={`letter-${letter}`}
              data-letter={letter}
            >
              <text
                x={LETTER_X[letter]}
                y={LETTER_BASELINE_Y}
                textAnchor="middle"
                className="jedflix-glyph"
              >
                {letter}
              </text>
            </g>
          ))}
        </g>

        <rect
          className="jedflix-shine-band"
          data-startup="shine"
          mask="url(#jedflixShineMask)"
          x="-140"
          y="24"
          width="180"
          height="132"
          fill="url(#jedflixShineGrad)"
          opacity="0"
          pointerEvents="none"
          aria-hidden="true"
        />
      </g>
    </svg>
  );
}
