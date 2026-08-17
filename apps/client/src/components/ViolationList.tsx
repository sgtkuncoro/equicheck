import * as Accordion from '@radix-ui/react-accordion';
import type { ScanResponse, WireViolation } from 'shared/wire';
import type { UseHelp } from '../hooks/useHelp.ts';
import { ImpactBadge } from './ImpactBadge.tsx';
import { NodeCard } from './NodeCard.tsx';

interface Props {
  scan: ScanResponse;
  expanded: string[];
  onExpandedChange: (value: string[]) => void;
  help: UseHelp;
}

function ViolationDetail({ violation, scanId, help }: { violation: WireViolation; scanId: string; help: UseHelp }) {
  const wcagTags = violation.tags.filter((tag) => tag.startsWith('wcag'));
  return (
    <>
      <p className="detail__desc">{violation.description}.</p>

      <div className="detail__meta">
        <ImpactBadge impact={violation.impact} />
        {wcagTags.length > 0 ? (
          <ul className="chips" aria-label={`WCAG tags for ${violation.id}`}>
            {wcagTags.map((tag) => (
              <li key={tag} className="chip">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p>
        {/* Link text carries the rule id so a page with twenty of these has
            twenty distinct accessible names, per SC 2.4.4. */}
        <a href={violation.helpUrl} target="_blank" rel="noopener noreferrer">
          Deque reference for {violation.id}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>

      <h4 className="detail__h">
        Failing elements ({violation.nodeCount})
        {violation.nodes.length < violation.nodeCount
          ? ` \u2013 showing the first ${violation.nodes.length}`
          : null}
      </h4>

      <ol className="nodes">
        {violation.nodes.map((node, index) => (
          <NodeCard
            key={`${node.target}-${index}`}
            node={node}
            index={index}
            total={violation.nodeCount}
            help={help.get(scanId, violation.id, index)}
            onRequestHelp={() => help.request(scanId, violation.id, index)}
          />
        ))}
      </ol>
    </>
  );
}

/**
 * An accordion, not tabs: tabs imply switching between peer views of one thing,
 * while these are N independent findings and a developer needs several open at
 * once to compare them.
 *
 * Radix rather than a hand-rolled disclosure. The keyboard contract alone is
 * arrow keys between triggers, Home and End, Enter and Space, plus
 * `aria-expanded`, `aria-controls` and `aria-labelledby` staying in sync. This
 * is a tool judged by accessibility specialists, so shipping a subtly broken
 * custom widget is the worst available outcome, and 12KB is a cheap way to
 * avoid it.
 *
 * `type="multiple"` and controlled `value`, so the summary's expand-all can
 * drive it.
 */
export function ViolationList({ scan, expanded, onExpandedChange, help }: Props) {
  return (
    <Accordion.Root
      type="multiple"
      value={expanded}
      onValueChange={onExpandedChange}
      className="acc"
    >
      {scan.violations.map((violation) => (
        <Accordion.Item key={violation.id} value={violation.id} className="acc__item">
          {/* asChild puts the trigger inside a real h3 whose only child is the
              button. Nesting anything else focusable in the heading would trip
              axe's nested-interactive rule. */}
          <Accordion.Header asChild>
            <h3 className="acc__heading">
              <Accordion.Trigger className="acc__trigger">
                <ImpactBadge impact={violation.impact} />
                <span className="acc__title">{violation.help}</span>
                <span className="acc__count">
                  {violation.nodeCount} element{violation.nodeCount === 1 ? '' : 's'}
                </span>
                <span className="acc__chevron" aria-hidden="true" />
              </Accordion.Trigger>
            </h3>
          </Accordion.Header>
          <Accordion.Content className="acc__content">
            <ViolationDetail violation={violation} scanId={scan.scanId} help={help} />
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
