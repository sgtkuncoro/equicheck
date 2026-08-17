interface Props {
  code: string;
  /** Visible caption, reused as the scroll region's accessible name. */
  label: string;
  truncated?: boolean;
}

/**
 * Renders markup as text.
 *
 * `code` goes in as a React text child, so React escapes it. There is no
 * `dangerouslySetInnerHTML` anywhere in this app: the point is to show the
 * markup, never to run it.
 *
 * `tabIndex={0}` is deliberate. The block scrolls, and a scrollable region has
 * to be keyboard reachable under WCAG 2.1.1. That is axe's own
 * `scrollable-region-focusable` rule, so getting it right here is the tool
 * practising what it reports. Tab still leaves the region, so it is not a trap.
 */
export function CodeSnippet({ code, label, truncated = false }: Props) {
  return (
    <figure className="snippet">
      <figcaption className="snippet__cap">{label}</figcaption>
      <pre className="snippet__pre" tabIndex={0} role="group" aria-label={label}>
        <code>{code}</code>
      </pre>
      {truncated ? (
        <p className="snippet__note">This element was longer than 2000 characters and was clipped.</p>
      ) : null}
    </figure>
  );
}
