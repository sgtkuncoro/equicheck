import type { ComponentPropsWithoutRef } from 'react';
import Markdown from 'react-markdown';

/**
 * Model output is untrusted text. react-markdown does not parse raw HTML unless
 * `rehype-raw` is added, and it is not added here, so a `<script>` in the answer
 * renders as visible characters. That is both safer and more useful: the reader
 * wants to see the markup.
 *
 * The allowlist also protects the page's own accessibility. `h1`, `h2` and `h3`
 * would corrupt the heading outline, `img` would fetch a remote asset chosen by
 * the model, and a model-authored `table` with no header row would fail this
 * app's own scan.
 */
const ALLOWED = [
  'p',
  'strong',
  'em',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'a',
  'br',
  'blockquote',
  'h4',
  'h5',
  'h6',
  'del',
];

function Anchor({ href, children }: ComponentPropsWithoutRef<'a'>) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function Pre(props: ComponentPropsWithoutRef<'pre'>) {
  // Code blocks in the answer scroll, so they need the same keyboard
  // reachability as CodeSnippet.
  return <pre tabIndex={0} role="group" aria-label="Suggested code" {...props} />;
}

// Hoisted, so react-markdown does not see a new prop identity on every render.
const COMPONENTS = { a: Anchor, pre: Pre, h4: 'h6', h5: 'h6', h6: 'h6' } as const;

export function MarkdownAnswer({ markdown }: { markdown: string }) {
  // A runaway generation must not be able to destroy the page.
  const capped =
    markdown.length > 8000 ? `${markdown.slice(0, 8000)}\n\n_Answer truncated._` : markdown;
  return (
    <div className="md">
      <Markdown allowedElements={ALLOWED} unwrapDisallowed components={COMPONENTS}>
        {capped}
      </Markdown>
    </div>
  );
}
