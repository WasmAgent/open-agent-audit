/**
 * ARS Score Donut Gauge — inline SVG ring showing score 0-100.
 * Color: green (>80), yellow (60-80), red (<60).
 * Pure SVG, no external deps.
 */
export function ArsDonut({ score, size = 80 }: { score: number; size?: number }) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const strokeWidth = size * 0.12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedScore / 100) * circumference;

  const color = clampedScore > 80 ? '#16a34a' : clampedScore >= 60 ? '#ca8a04' : '#dc2626';
  const bgColor =
    clampedScore > 80
      ? 'rgba(22,163,74,0.12)'
      : clampedScore >= 60
        ? 'rgba(202,138,4,0.12)'
        : 'rgba(220,38,38,0.12)';

  return (
    <div
      className="inline-flex items-center justify-center relative"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        {/* Score arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {/* Centered score label */}
      <span className="absolute font-bold" style={{ color, fontSize: size * 0.24 }}>
        {clampedScore}
      </span>
    </div>
  );
}
