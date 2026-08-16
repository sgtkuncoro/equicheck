import { useId, useRef, useState } from 'react';
import type { ScanRequest } from '../../../shared/wire.ts';
import { normalizeUrl, type UrlCheck } from '../lib/normalizeUrl.ts';

interface Props {
  busy: boolean;
  onSubmit: (body: ScanRequest, target: string) => void;
  onCancel: () => void;
}

const SAMPLE = `<img src="logo.png">
<button></button>
<p style="color:#bbb;background:#fff">Low contrast text</p>`;

export function ScanForm({ busy, onSubmit, onCancel }: Props) {
  const [mode, setMode] = useState<'url' | 'html'>('url');
  // Both values are held independently, so switching mode never destroys typing.
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const urlId = useId();
  const htmlId = useId();
  const urlRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Returns the check rather than a message, so the caller uses the same
   * normalised value it wrote back into the field. Returning only the message
   * meant re-normalising at the call site, which works today because the function
   * is idempotent and would silently scan something other than what is displayed
   * the moment it stopped being.
   */
  function checkUrl(): UrlCheck {
    const check = normalizeUrl(url);
    // Write the normalisation back so the user sees what will be scanned.
    if (check.ok) setUrl(check.url);
    return check;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);

    if (mode === 'url') {
      const check = checkUrl();
      if (!check.ok) {
        setError(check.message);
        // The one place focus should move: the user pressed a button and nothing
        // happened, so take them to the problem. When they submitted with Enter
        // focus is already here and this is a no-op, which is why the error node
        // carries role="alert" rather than relying on aria-describedby.
        urlRef.current?.focus();
        return;
      }
      setError(null);
      onSubmit({ url: check.url }, check.url);
      return;
    }

    if (html.trim() === '') {
      setError('Paste some HTML to check.');
      htmlRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit({ html }, 'Inline HTML snippet');
  }

  const errorId = `${mode === 'url' ? urlId : htmlId}-error`;
  const hintId = `${mode === 'url' ? urlId : htmlId}-hint`;

  return (
    <section className="panel" aria-labelledby="scan-heading">
      <h2 className="panel__h" id="scan-heading">
        Run a scan
      </h2>

      {/* noValidate so our specific messages win over the browser's generic
          "Please enter a URL". */}
      <form onSubmit={handleSubmit} noValidate>
        {/* A radio group, not a tablist. This picks which value the form submits,
            it does not navigate between views, and the browser gives arrow-key
            handling and the group name from the legend for free. */}
        <fieldset className="modes">
          <legend className="modes__legend">What do you want to check?</legend>
          <div className="modes__row">
            <label className="modes__opt">
              <input
                type="radio"
                name="mode"
                value="url"
                checked={mode === 'url'}
                onChange={() => {
                  setMode('url');
                  setError(null);
                }}
              />
              <span>A live web page</span>
            </label>
            <label className="modes__opt">
              <input
                type="radio"
                name="mode"
                value="html"
                checked={mode === 'html'}
                onChange={() => {
                  setMode('html');
                  setError(null);
                }}
              />
              <span>An HTML snippet</span>
            </label>
          </div>
        </fieldset>

        {mode === 'url' ? (
          <div className="field">
            <label className="field__label" htmlFor={urlId}>
              Web address to scan
            </label>
            <p className="field__hint" id={hintId}>
              Include the full path, for example
              https://www.w3.org/WAI/demos/bad/before/home.html
            </p>
            <input
              ref={urlRef}
              id={urlId}
              name="url"
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              className={`field__input${error ? ' field__input--invalid' : ''}`}
              value={url}
              // Validation happens on submit only. Validating on blur meant the
              // error appeared while the pointer was travelling to the submit
              // button, the layout shifted, and the click landed on nothing.
              // Clearing a stale error as the user types is the useful half.
              onChange={(event) => {
                setUrl(event.target.value);
                if (submitted && error && normalizeUrl(event.target.value).ok) setError(null);
              }}
              // Error before hint, so the correction is heard first.
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              aria-invalid={error ? true : undefined}
            />
          </div>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={htmlId}>
              HTML snippet to check
            </label>
            <p className="field__hint" id={hintId}>
              Rendered with no base URL, so relative stylesheet paths will not load and contrast
              results can be misleading.
            </p>
            <textarea
              ref={htmlRef}
              id={htmlId}
              name="html"
              className={`field__area${error ? ' field__area--invalid' : ''}`}
              value={html}
              onChange={(event) => {
                setHtml(event.target.value);
                if (error && event.target.value.trim() !== '') setError(null);
              }}
              spellCheck={false}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              aria-invalid={error ? true : undefined}
            />
            <p className="field__extra">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setHtml(SAMPLE);
                  setError(null);
                }}
              >
                Insert an example with known violations
              </button>
            </p>
          </div>
        )}

        {error ? (
          <p className="field__err" id={errorId} role="alert">
            <span className="field__err-glyph" aria-hidden="true" /> {error}
          </p>
        ) : null}

        <div className="actions">
          {/* aria-disabled, never the disabled attribute: a disabled button
              leaves the tab order, so the browser drops focus to body at exactly
              the moment the user needs feedback. The label change is the state
              change, and because the accessible name changes while the button
              holds focus, it is announced without a live region. */}
          <button
            type="submit"
            className="btn btn--primary"
            aria-disabled={busy || undefined}
            onClick={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Scanning&#8230;
              </>
            ) : (
              'Run accessibility scan'
            )}
          </button>
          {/* Always mounted, for the same reason the submit button is never truly
              disabled: someone tabs here to decide whether to wait, and removing
              the button when the scan lands would drop their focus to body. */}
          <button
            type="button"
            className="btn btn--secondary"
            aria-disabled={!busy || undefined}
            onClick={() => {
              if (busy) onCancel();
            }}
          >
            Cancel scan
          </button>
        </div>
      </form>
    </section>
  );
}
