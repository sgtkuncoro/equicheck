import { useEffect, useState } from 'react';
import type { ScanRequest } from 'shared/wire';
import { EmptyState } from './components/EmptyState.tsx';
import { ErrorBanner } from './components/ErrorBanner.tsx';
import { ResultsSummary } from './components/ResultsSummary.tsx';
import { ScanForm } from './components/ScanForm.tsx';
import { ScanProgress } from './components/ScanProgress.tsx';
import { ViolationList } from './components/ViolationList.tsx';
import { useHelp } from './hooks/useHelp.ts';
import { useScan } from './hooks/useScan.ts';

export function App() {
  const { state, start, cancel } = useScan();
  const help = useHelp();
  const [expanded, setExpanded] = useState<string[]>([]);

  const scan = state.status === 'ok' ? state.data : null;

  // A changing title is how someone who switched tabs learns the scan finished.
  useEffect(() => {
    document.title = scan
      ? `${scan.counts.violations} violations - EquiCheck`
      : 'EquiCheck - accessibility scanner';
  }, [scan]);

  function handleSubmit(body: ScanRequest, target: string) {
    setExpanded([]);
    start(body, target);
  }

  const allIds = scan?.violations.map((violation) => violation.id) ?? [];
  const allExpanded = allIds.length > 0 && expanded.length === allIds.length;

  /**
   * One live region for the whole page, mounted before any of these strings
   * exist. A region created together with its content is commonly not spoken at
   * all, because there is nothing for the screen reader to diff against, so the
   * announcement has to be a change inside a region that is already there.
   *
   * Errors are omitted deliberately: ErrorBanner is a `role="alert"`, and
   * announcing the same failure twice is worse than announcing it once.
   */
  const announcement =
    state.status === 'cancelled'
      ? 'Scan cancelled.'
      : scan
        ? `Scan complete. ${scan.counts.violations} rules failed.`
        : '';

  return (
    <>
      {/* First focusable element on the page. */}
      <a className="skip" href="#main">
        Skip to main content
      </a>

      <header className="header">
        <div className="container">
          <h1 className="header__title">EquiCheck</h1>
          <p className="header__tagline">
            Scan a page or an HTML snippet against WCAG 2.0, 2.1 and 2.2 level A and AA rules with
            axe-core, then ask an AI assistant to explain any finding.
          </p>
        </div>
      </header>

      {/* Exactly one main, owned here and never rendered by a child.
          tabindex="-1" so the skip link reliably lands. */}
      <main className="main" id="main" tabIndex={-1}>
        <p className="sr-only" role="status">
          {announcement}
        </p>

        <div className="container stack">
          <ScanForm busy={state.status === 'pending'} onSubmit={handleSubmit} onCancel={cancel} />

          {state.status === 'pending' ? <ScanProgress target={state.target} /> : null}

          {state.status === 'error' ? (
            <ErrorBanner code={state.code} message={state.message} />
          ) : null}

          {state.status === 'cancelled' ? <p className="notice">Scan cancelled.</p> : null}
        </div>

        {scan ? (
          // Wider than the prose measure: this region's content is CSS selectors
          // and HTML, which wrap badly at 74ch.
          <div className="container container--wide">
            <section aria-labelledby="results-heading" className="stack">
              {scan.warnings.map((warning) => (
                <p className="warning" key={warning}>
                  {warning}
                </p>
              ))}

              {scan.violations.length === 0 ? (
                <EmptyState scan={scan} />
              ) : (
                <div>
                  <ResultsSummary
                    scan={scan}
                    allExpanded={allExpanded}
                    onToggleAll={() => setExpanded(allExpanded ? [] : allIds)}
                  />
                  <ViolationList
                    scan={scan}
                    expanded={expanded}
                    onExpandedChange={setExpanded}
                    help={help}
                  />
                </div>
              )}
            </section>
          </div>
        ) : null}
      </main>

      <footer className="footer">
        <div className="container">
          Automated checks find roughly a third of accessibility problems, so treat a clean result
          as a starting point rather than a pass.
        </div>
      </footer>
    </>
  );
}
