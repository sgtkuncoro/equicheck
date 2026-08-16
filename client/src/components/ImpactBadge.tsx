import type { Impact } from '../../../shared/wire.ts';
import { impactStyle } from '../lib/impact.ts';

interface Props {
  impact: Impact | null;
  count?: number;
}

export function ImpactBadge({ impact, count }: Props) {
  const style = impactStyle(impact);
  return (
    <span className={`badge ${style.className}`}>
      {/* Empty on purpose: the glyph is CSS generated content. See impact.ts. */}
      <span className="badge__glyph" aria-hidden="true" />
      {count === undefined ? style.label : `${style.label} ${count}`}
    </span>
  );
}
