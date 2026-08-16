import type { ScanResponse } from '../../../shared/wire.ts';

/**
 * A clean scan is not a clean bill of health, and saying so is the most important
 * sentence on this screen. Automated rules cover a minority of WCAG; implying
 * otherwise would make the tool actively misleading.
 */
export function EmptyState({ scan }: { scan: ScanResponse }) {
  return (
    <div className="empty">
      <h2 className="empty__h" id="results-heading">
        No automated violations found
      </h2>
      <p>
        axe-core found no failures against WCAG 2.0, 2.1 and 2.2 level A and AA rules on{' '}
        {scan.target}. {scan.counts.passes} rules passed.
      </p>
      <p className="empty__caveat">
        {scan.counts.incomplete} check{scan.counts.incomplete === 1 ? '' : 's'} on this page still
        need a human. Keyboard order, focus visibility, reading order and whether alternative text
        is actually meaningful cannot be judged automatically at all.
      </p>
      <p>Try another page, or paste a component's HTML to check it in isolation.</p>
    </div>
  );
}
