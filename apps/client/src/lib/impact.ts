import type { Impact } from 'shared/wire';

interface ImpactStyle {
  label: string;
  className: string;
}

/**
 * Impact is communicated four ways: the word, a glyph, sort position, and only
 * then colour. In Windows High Contrast mode every badge renders in one system
 * colour, which is exactly why the first three exist.
 *
 * The glyph is not here. It is generated content in `app.css`, keyed off the
 * class, because axe's `color-contrast` rule samples DOM text nodes and reports
 * a symbol-only element as `incomplete` forever, while CSS content is invisible
 * to it. Folding the glyph into the badge's own text run instead would put it in
 * the accessible name, where a screen reader says "multiplication x Critical".
 */
const STYLES: Record<Impact, ImpactStyle> = {
  critical: { label: 'Critical', className: 'badge--critical' },
  serious: { label: 'Serious', className: 'badge--serious' },
  moderate: { label: 'Moderate', className: 'badge--moderate' },
  minor: { label: 'Minor', className: 'badge--minor' },
};

const UNRANKED: ImpactStyle = { label: 'Unrated', className: 'badge--none' };

export function impactStyle(impact: Impact | null): ImpactStyle {
  return impact ? STYLES[impact] : UNRANKED;
}

/** Display and triage order. `null` is appended by callers that must tally every violation. */
export const IMPACT_ORDER: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'];
