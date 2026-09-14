// The school's crest, supplied by Vasant Valley School for this app.
export function Logo({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/vv-logo.png" alt="Vasant Valley School" width={size} height={size}
      className={`shrink-0 select-none rounded-sm bg-white object-contain p-1 shadow-card ${className}`}
      draggable={false}
    />
  );
}
