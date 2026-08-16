import type { Impact, ScanResponse } from '../../../shared/wire.ts';
import { IMPACT_ORDER } from '../lib/impact.ts';
import { ImpactBadge } from './ImpactBadge.tsx';

interface Props {
  scan: ScanResponse;
  allExpanded: boolean;
  onToggleAll: () => void;
}

// `null` is included so the badges always sum to the number in the sentence
// above them. axe does not assign an impact to every rule, and a tally that
// quietly omits those would contradict the lede.
const TALLY_ORDER: readonly (Impact | null)[] = [...IMPACT_ORDER, null];

export function ResultsSummary({ scan, allExpanded, onToggleAll }: Props) {
  const elements = scan.violations.reduce((total, violation) => total + violation.nodeCount, 0);
  const tally = TALLY_ORDER.map((impact) => ({
    impact,
    count: scan.violations.filter((violation) => violation.impact === impact).length,
  })).filter((entry) => entry.count > 0);

  return (
    <div>
      <h2 className="summary__h" id="results-heading">
        Scan results
      </h2>
      <p className="summary__lede">
        {scan.counts.violations} rule{scan.counts.violations === 1 ? '' : 's'} failed, affecting{' '}
        {elements} element{elements === 1 ? '' : 's'}.
      </p>
      <p className="summary__meta">
        {/* Rendered as text, not a link: one click from here to an arbitrary
            address the user pasted is not a navigation this page should offer. */}
        {scan.target} &middot; scanned{' '}
        {new Date(scan.scannedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}{' '}
        &middot; took {(scan.durationMs / 1000).toFixed(1)}s
        {scan.targetStatus !== null && scan.targetStatus >= 400
          ? ` \u00b7 target returned HTTP ${scan.targetStatus}`
          : null}
      </p>

      {tally.length > 0 ? (
        <ul className="summary__tally" aria-label="Violations by impact">
          {tally.map((entry) => (
            <li key={String(entry.impact)}>
              <ImpactBadge impact={entry.impact} count={entry.count} />
            </li>
          ))}
        </ul>
      ) : null}

      {scan.violations.length > 0 ? (
        <p className="summary__actions">
          <button type="button" className="btn btn--ghost" onClick={onToggleAll}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </p>
      ) : null}

      {/* "Needs a human review" is the honest reading of axe's `incomplete`
          bucket. Folding it into the pass count would be the dishonest one. */}
      <p className="summary__also">
        Also checked: {scan.counts.passes} rules passed, {scan.counts.incomplete} need a human
        review, {scan.counts.inapplicable} did not apply to this page.
      </p>
    </div>
  );
}
