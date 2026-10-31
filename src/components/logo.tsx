import { useId } from "react";

/** Lefort OS: a hanger on a green tile (same drawing as src/app/icon.svg) */
export function Logo({ className = "size-9" }: { className?: string }) {
  // one gradient per logo: a hidden copy (menu of the other screen size) must not hold the only one
  const id = `lefort-logo-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 512 512" className={`${className} shrink-0 drop-shadow-[0_0_18px_rgba(34,197,94,0.35)]`} role="img" aria-label="Lefort OS">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4ade80" /><stop offset="1" stopColor="#166534" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill={`url(#${id})`} />
      <g transform="translate(0 26)" fill="none" stroke="#f0fdf4" strokeWidth="38" strokeLinecap="round" strokeLinejoin="round">
        <path d="M212 148c0-34 20-56 46-56s44 20 44 44c0 26-18 38-46 52v26" />
        <path d="M256 214 96 362h320z" />
      </g>
    </svg>
  );
}
