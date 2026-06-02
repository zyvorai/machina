// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { ZYVOR_URL } from './ZyvorBrand';

const ORANGE = '#f97316';
const ORANGE_LIGHT = '#fb923c';

const MARK_SIZES = { sm: 28, md: 36, lg: 48 } as const;
const WORDMARK_SIZES = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' } as const;

export type ZyvorAiLogoSize = keyof typeof MARK_SIZES;

type ZyvorAiLogoProps = {
  size?: ZyvorAiLogoSize;
  showWordmark?: boolean;
  className?: string;
  /** When set, wraps mark in a link to zyvor.dev */
  linked?: boolean;
};

function ZyvorAiLogoMarkSvg({ sizePx }: { sizePx: number }) {
  return (
    <svg
      width={sizePx}
      height={sizePx}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="shrink-0"
    >
      <rect x="2" y="2" width="44" height="44" rx="10" fill="#121820" stroke="rgba(140,160,190,0.25)" strokeWidth="1" />
      <path
        d="M24 10L34 16V28L24 34L14 28V16L24 10Z"
        stroke={ORANGE}
        strokeWidth="2"
        strokeLinejoin="round"
        fill="rgba(249,115,22,0.08)"
      />
      <circle cx="24" cy="22" r="4" fill={ORANGE} />
      <path d="M24 26V32" stroke={ORANGE_LIGHT} strokeWidth="2" strokeLinecap="round" />
      <path d="M20 30H28" stroke={ORANGE_LIGHT} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/** Compact mark only — for headers and favicon-style placements. */
export function ZyvorAiLogoMark({
  size = 'md',
  className = '',
}: {
  size?: ZyvorAiLogoSize;
  className?: string;
}) {
  return (
    <span className={`inline-flex ${className}`.trim()} aria-hidden>
      <ZyvorAiLogoMarkSvg sizePx={MARK_SIZES[size]} />
    </span>
  );
}

/** ZyvorAI logo mark with optional wordmark. */
export function ZyvorAiLogo({
  size = 'md',
  showWordmark = true,
  className = '',
  linked = false,
}: ZyvorAiLogoProps) {
  const mark = <ZyvorAiLogoMarkSvg sizePx={MARK_SIZES[size]} />;
  const content = (
    <span
      className={`inline-flex items-center gap-3 ${className}`.trim()}
      aria-label={showWordmark ? 'ZyvorAI' : undefined}
    >
      {linked ? (
        <a href={ZYVOR_URL} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60">
          {mark}
        </a>
      ) : (
        mark
      )}
      {showWordmark ? (
        <span className={`font-semibold tracking-tight text-white ${WORDMARK_SIZES[size]}`}>
          <span style={{ color: ORANGE }}>Zyvor</span>
          <span className="text-slate-100">AI</span>
        </span>
      ) : null}
    </span>
  );
  return content;
}

export default ZyvorAiLogo;
