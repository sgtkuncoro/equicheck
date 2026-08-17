import type { AxeResults, NodeResult, Result } from 'axe-core';
import { describe, expect, it } from 'vitest';
import { limits } from '../config.js';
import { countResults, mapViolations } from './mapResults.js';

function node(overrides: Partial<NodeResult> = {}): NodeResult {
  return {
    html: '<img src="a.png">',
    target: ['img'],
    failureSummary: 'Fix any of the following:\n  Element has no alt attribute',
    any: [],
    all: [],
    none: [],
    ...overrides,
  } as NodeResult;
}

function violation(overrides: Partial<Result> = {}): Result {
  return {
    id: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternative text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/image-alt',
    description: 'Ensures <img> elements have alternate text',
    tags: ['cat.text-alternatives', 'wcag2a', 'wcag111'],
    nodes: [node()],
    ...overrides,
  } as Result;
}

function results(violations: Result[]): AxeResults {
  return {
    violations,
    passes: [violation(), violation()],
    incomplete: [violation()],
    inapplicable: [],
  } as unknown as AxeResults;
}

describe('mapViolations', () => {
  it('carries every field the results view renders', () => {
    const [mapped] = mapViolations(results([violation()]));
    expect(mapped).toEqual({
      id: 'image-alt',
      impact: 'critical',
      help: 'Images must have alternative text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/image-alt',
      description: 'Ensures <img> elements have alternate text',
      tags: ['cat.text-alternatives', 'wcag2a', 'wcag111'],
      nodeCount: 1,
      nodes: [
        {
          html: '<img src="a.png">',
          target: 'img',
          failureSummary: 'Fix any of the following:\n  Element has no alt attribute',
          truncated: false,
        },
      ],
    });
  });

  it('orders by impact, then by how many elements fail, then by rule id', () => {
    const mapped = mapViolations(
      results([
        violation({ id: 'minor-one', impact: 'minor' }),
        violation({ id: 'serious-few', impact: 'serious', nodes: [node()] }),
        violation({ id: 'critical-one', impact: 'critical' }),
        violation({ id: 'serious-many', impact: 'serious', nodes: [node(), node(), node()] }),
        violation({ id: 'unranked', impact: null }),
      ]),
    );
    expect(mapped.map((v) => v.id)).toEqual([
      'critical-one',
      'serious-many',
      'serious-few',
      'minor-one',
      'unranked',
    ]);
  });

  it('clamps oversized markup and says so', () => {
    const long = `<div>${'x'.repeat(limits.maxNodeHtmlChars * 2)}</div>`;
    const [mapped] = mapViolations(results([violation({ nodes: [node({ html: long })] })]));
    expect(mapped?.nodes[0]?.html).toHaveLength(limits.maxNodeHtmlChars);
    expect(mapped?.nodes[0]?.truncated).toBe(true);
  });

  it('caps rendered elements while still reporting the true total', () => {
    const many = Array.from({ length: limits.maxNodesPerViolation + 17 }, () => node());
    const [mapped] = mapViolations(results([violation({ nodes: many })]));
    expect(mapped?.nodes).toHaveLength(limits.maxNodesPerViolation);
    expect(mapped?.nodeCount).toBe(limits.maxNodesPerViolation + 17);
  });

  it('flattens a selector that crosses a frame boundary', () => {
    const [mapped] = mapViolations(
      results([violation({ nodes: [node({ target: [['#frame', 'button.x']] as never })] })]),
    );
    expect(mapped?.nodes[0]?.target).toBe('#frame button.x');
  });

  it('keeps a missing failure summary as null rather than an empty string', () => {
    const [mapped] = mapViolations(
      results([violation({ nodes: [node({ failureSummary: undefined })] })]),
    );
    expect(mapped?.nodes[0]?.failureSummary).toBeNull();
  });
});

describe('countResults', () => {
  it('reduces the non-violation buckets to counts', () => {
    expect(countResults(results([violation(), violation()]))).toEqual({
      violations: 2,
      passes: 2,
      incomplete: 1,
      inapplicable: 0,
    });
  });
});
