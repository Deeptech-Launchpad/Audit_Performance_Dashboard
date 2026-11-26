// "Mistakes by type" per ATTRIBUTE: adds up to "Attributes with errors"; SKUs with several error codes are shown together, never guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeTypeBreakdown, attributeMetrics } from '../src/analytics/compute.js';

const types = new Map([['DM', { name: 'Data Missing', isError: true }], ['DE', { name: 'Data Error', isError: true }], ['RBE', { name: 'Re-build Error', isError: true }]]);
const rec = (skuId, errs, names, extra = {}) => ({ skuId, sampled: true, errs, attrsEnriched: 10, attrInfo: names.map((n) => ({ name: n, isAttribute: n !== 'Source', wasEnriched: true })), ...extra });

test('per attribute: single-code SKUs give their code; mixed codes are grouped; non-attributes and repeats are not counted', () => {
  const recs = [
    rec('A', ['DM'], ['Color', 'Width', 'Height']),        // 3 x DM
    rec('B', ['DE'], ['Material']),                          // 1 x DE
    rec('C', ['DM', 'DE'], ['Flow', 'Priming']),             // 2 x "DE or DM"
    rec('D', ['DE', 'DM'], ['Seal']),                        // same group, other order
    rec('E', ['RBE'], []),                                   // no attribute named -> nothing
    rec('F', ['DM'], ['Source']),                            // not an attribute -> nothing
    rec('A', ['DM'], ['Color']),                             // the same SKU + attribute again -> once
    rec('G', [], ['Color']),                                 // no error -> nothing
  ];
  const out = attributeTypeBreakdown(recs, types);
  assert.deepEqual(out.map((t) => [t.code, t.attributes, t.mixed]), [['DM', 3, false], ['DE', 1, false], ['DE|DM', 3, true]]);
  assert.equal(out.find((t) => t.mixed).name, 'Data Error or Data Missing');
  assert.equal(out.reduce((a, t) => a + t.attributes, 0), attributeMetrics(recs).attrErrors);
});
