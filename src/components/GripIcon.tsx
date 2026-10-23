/**
 * The six-dot drag handle shown on everything that can be moved while the
 * dashboard is in "Arrange layout" mode (cards, stat cards, category tabs).
 */
export default function GripIcon({ className = "h-3.5 w-2.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" className={`${className} fill-current`} aria-hidden="true">
      <circle cx="2" cy="3" r="1.3" />
      <circle cx="8" cy="3" r="1.3" />
      <circle cx="2" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="2" cy="13" r="1.3" />
      <circle cx="8" cy="13" r="1.3" />
    </svg>
  );
}
