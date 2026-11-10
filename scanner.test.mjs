import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenFixture, getNotionTextBlocks, localPresidioUrl, scanBlocks } from './scanner.mjs';

test('reads nested fixture blocks without adding unsupported content', () => {
  const blocks = flattenFixture([
    { id: 'a', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'hello' }] } },
    { id: 'b', type: 'toggle', toggle: { rich_text: [] }, children: [
      { id: 'c', type: 'code', code: { rich_text: [{ plain_text: 'secret' }] } },
    ] },
    { id: 'd', type: 'image', image: { caption: [{ plain_text: 'ignored' }] } },
  ]);
  assert.deepEqual(blocks, [{ block_id: 'a', text: 'hello' }, { block_id: 'c', text: 'secret' }]);
});

test('follows Notion pagination and child blocks', async () => {
  const seen = [];
  const fakeFetch = async (url, options) => {
    seen.push({ url: String(url), version: options.headers['Notion-Version'] });
    let payload;
    if (String(url).includes('/blocks/page/children') && !String(url).includes('start_cursor')) {
      payload = { results: [{ id: 'a', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'first' }] }, has_children: true }], has_more: true, next_cursor: 'next' };
    } else if (String(url).includes('/blocks/a/children')) {
      payload = { results: [{ id: 'b', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'nested' }] } }], has_more: false };
    } else {
      payload = { results: [{ id: 'c', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'second' }] } }], has_more: false };
    }
    return { ok: true, json: async () => payload };
  };
  const blocks = await getNotionTextBlocks('page', 'fake-token', fakeFetch, 0);
  assert.deepEqual(blocks.map(block => block.text), ['first', 'nested', 'second']);
  assert.equal(seen.length, 3);
  assert.ok(seen.every(call => call.version === '2026-03-11'));
});

test('reports Presidio findings without returning matched text', async () => {
  const fakeFetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.language, 'en');
    assert.deepEqual(request.entities, ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'US_SSN', 'CREDIT_CARD']);
    return { ok: true, json: async () => [{ entity_type: 'EMAIL_ADDRESS', score: 0.876, start: 8, end: 28 }] };
  };
  const report = await scanBlocks('demo', [{ block_id: 'a', text: 'Contact jane.doe@example.com' }], 'http://127.0.0.1:3000', fakeFetch);
  assert.equal(report.status, 'review_required');
  assert.deepEqual(report.findings, [{ block_id: 'a', entity_type: 'EMAIL_ADDRESS', score: 0.88 }]);
  assert.ok(!JSON.stringify(report).includes('jane.doe'));
});

test('rejects remote analyzers to avoid accidental PII transmission', () => {
  assert.throws(() => localPresidioUrl('https://example.com'), /this computer/);
});
