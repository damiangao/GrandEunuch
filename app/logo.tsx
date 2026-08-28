/** The steward's seal: cinnabar square, three ledger lines. */
export function Logo({ size = 30 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="seal-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D2452F" />
          <stop offset="1" stopColor="#A72B20" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#seal-red)" />
      <rect x="112" y="128" width="288" height="46" rx="23" fill="#ffffff" />
      <rect x="112" y="233" width="288" height="46" rx="23" fill="#ffffff" />
      <rect x="112" y="338" width="176" height="46" rx="23" fill="#ffffff" fillOpacity="0.92" />
    </svg>
  );
}
