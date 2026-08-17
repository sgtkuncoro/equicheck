import { useId, useState } from 'react';
import type { WireNode } from 'shared/wire';
import type { HelpState } from '../hooks/useHelp.ts';
import { CodeSnippet } from './CodeSnippet.tsx';
import { HelpPanel } from './HelpPanel.tsx';

interface Props {
  node: WireNode;
  index: number;
  total: number;
  help: HelpState;
  onRequestHelp: () => void;
}

export function NodeCard({ node, index, total, help, onRequestHelp }: Props) {
  const [open, setOpen] = useState(false);
  // Ids come from useId, never from the array index. Templating ids by index is
  // the fastest route to axe's duplicate-id-aria violation on a page that
  // renders a few hundred of these.
  const panelId = useId();
  const buttonId = useId();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && help.status === 'idle') onRequestHelp();
  }

  return (
    <li>
      <p className="node__target">
        <span className="sr-only">Selector: </span>
        {node.target}
      </p>
      {node.failureSummary ? <p className="node__summary">{node.failureSummary}</p> : null}

      <CodeSnippet
        code={node.html}
        truncated={node.truncated}
        label={`Failing HTML, element ${index + 1} of ${total}`}
      />

      <button
        type="button"
        id={buttonId}
        className="btn btn--secondary"
        aria-expanded={open}
        // Only while the panel exists. A permanent aria-controls pointing at an
        // unmounted node is a dangling IDREF that JAWS offers to jump to and then
        // fails on. Radix's own Collapsible makes the identical choice, and
        // aria-expanded is what actually carries the state.
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        {/* The visible label is exactly "Get help", as specified. A page holds
            dozens of these, so a visually hidden qualifier keeps them
            distinguishable. It repeats the snippet caption rather than the axe
            rule id, because the enclosing h3 already announces the rule. */}
        Get help
        <span className="sr-only">{` with element ${index + 1} of ${total}`}</span>
      </button>

      {open ? (
        <HelpPanel id={panelId} labelledBy={buttonId} state={help} onRetry={onRequestHelp} />
      ) : null}
    </li>
  );
}
