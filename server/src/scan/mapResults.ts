import type { AxeResults, NodeResult, Result } from 'axe-core';
import { limits } from '../config.js';
import type { Impact, ScanCounts, WireNode, WireViolation } from '../../../shared/wire.js';

/** Most severe first. Also the display order the client relies on. */
const IMPACT_RANK: Record<Impact, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

function toWireNode(node: NodeResult): WireNode {
  const html = node.html ?? '';
  // axe types `target` as a selector that may nest one level per frame or shadow
  // boundary. Flattening loses which frame an element lived in: a real but
  // narrow loss, documented in the README rather than silently handled. It is
  // clamped because class names and nesting depth are attacker-influenced and
  // this string reaches the LLM prompt.
  const target = (node.target as unknown as unknown[])
    .flat(Infinity)
    .map(String)
    .join(' ')
    .slice(0, limits.maxSelectorChars);
  return {
    html: html.slice(0, limits.maxNodeHtmlChars),
    target,
    failureSummary: node.failureSummary ?? null,
    truncated: html.length > limits.maxNodeHtmlChars,
  };
}

function toWireViolation(result: Result): WireViolation {
  return {
    id: result.id,
    impact: (result.impact as Impact | undefined) ?? null,
    help: result.help,
    helpUrl: result.helpUrl,
    description: result.description,
    tags: result.tags,
    nodeCount: result.nodes.length,
    nodes: result.nodes.slice(0, limits.maxNodesPerViolation).map(toWireNode),
  };
}

/**
 * Order violations the way a developer should triage them: severity first, then
 * how widespread the rule failure is, then rule id so two scans of the same page
 * never shuffle rows.
 */
export function mapViolations(results: AxeResults): WireViolation[] {
  return results.violations
    .map(toWireViolation)
    .sort(
      (a, b) =>
        (a.impact ? IMPACT_RANK[a.impact] : 4) - (b.impact ? IMPACT_RANK[b.impact] : 4) ||
        b.nodeCount - a.nodeCount ||
        a.id.localeCompare(b.id),
    );
}

/**
 * `passes`, `incomplete` and `inapplicable` are reduced to counts on purpose.
 * Their full detail is comparable in size to `violations` and the UI has no
 * screen for it; the counts still let the results page be honest about how much
 * axe checked and how much still needs a human.
 */
export function countResults(results: AxeResults): ScanCounts {
  return {
    violations: results.violations.length,
    passes: results.passes.length,
    incomplete: results.incomplete.length,
    inapplicable: results.inapplicable.length,
  };
}
