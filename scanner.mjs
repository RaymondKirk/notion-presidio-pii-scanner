import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const NOTION_VERSION = '2026-03-11';
const ENTITIES = ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'US_SSN', 'CREDIT_CARD'];
const TEXT_TYPES = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item',
  'numbered_list_item', 'to_do', 'quote', 'callout', 'toggle', 'code',
]);

export function textFromBlock(block) {
  if (!TEXT_TYPES.has(block.type)) return '';
  return (block[block.type]?.rich_text ?? [])
    .map(item => item.plain_text ?? item.text?.content ?? '')
    .join('');
}

export function flattenFixture(blocks, output = []) {
  for (const block of blocks) {
    const text = textFromBlock(block);
    if (text.trim()) output.push({ block_id: block.id, text });
    if (Array.isArray(block.children)) flattenFixture(block.children, output);
  }
  return output;
}

async function notionJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Notion request failed (${response.status})`);
  return response.json();
}

export async function getNotionTextBlocks(pageId, token, fetchImpl = fetch, delayMs = 350) {
  if (!pageId || !token) throw new Error('Page ID and Notion token are required');
  const output = [];
  let requests = 0;
  let lastRequestAt = 0;

  async function visit(parentId, depth) {
    if (depth > 8) throw new Error('Maximum block depth exceeded');
    let cursor;
    do {
      if (++requests > 100) throw new Error('Maximum Notion request count exceeded');
      const url = new URL(`https://api.notion.com/v1/blocks/${encodeURIComponent(parentId)}/children`);
      url.searchParams.set('page_size', '100');
      if (cursor) url.searchParams.set('start_cursor', cursor);
      const waitMs = Math.max(0, delayMs - (Date.now() - lastRequestAt));
      if (lastRequestAt && waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastRequestAt = Date.now();
      const data = await notionJson(url, token, fetchImpl);
      for (const block of data.results ?? []) {
        const text = textFromBlock(block);
        if (text.trim()) output.push({ block_id: block.id, text });
        if (block.has_children) await visit(block.id, depth + 1);
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  }

  await visit(pageId, 0);
  return output;
}

export function localPresidioUrl(value) {
  const url = new URL(value || 'http://127.0.0.1:3000');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Presidio URL must point to this computer');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported Presidio URL');
  return new URL('/analyze', url);
}

export async function scanBlocks(pageId, blocks, analyzerUrl, fetchImpl = fetch) {
  const endpoint = localPresidioUrl(analyzerUrl);
  const findings = [];
  for (const block of blocks) {
    if (!block.text?.trim()) continue;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: block.text,
        language: 'en',
        entities: ENTITIES,
        score_threshold: 0.5,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Presidio request failed (${response.status})`);
    const results = await response.json();
    if (!Array.isArray(results)) throw new Error('Unexpected Presidio response');
    for (const result of results) {
      if (!ENTITIES.includes(result.entity_type) || !Number.isFinite(result.score)) continue;
      findings.push({
        block_id: block.block_id,
        entity_type: result.entity_type,
        score: Math.round(result.score * 100) / 100,
      });
    }
  }
  return {
    status: findings.length ? 'review_required' : 'no_findings',
    page_id: pageId,
    blocks_scanned: blocks.filter(block => block.text?.trim()).length,
    findings,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const fixtureIndex = args.indexOf('--fixture');
  const pageIndex = args.indexOf('--page-id');
  if ((fixtureIndex >= 0) === (pageIndex >= 0)) {
    throw new Error('Choose exactly one of --fixture FILE or --page-id ID');
  }
  let pageId;
  let blocks;
  if (fixtureIndex >= 0) {
    const path = args[fixtureIndex + 1];
    if (!path) throw new Error('Fixture path is required');
    const fixture = JSON.parse(await fs.readFile(path, 'utf8'));
    pageId = fixture.page_id;
    blocks = flattenFixture(fixture.blocks ?? []);
  } else {
    pageId = args[pageIndex + 1];
    const token = process.env.NOTION_TOKEN;
    if (!pageId || !token) throw new Error('Page ID and NOTION_TOKEN are required');
    blocks = await getNotionTextBlocks(pageId, token);
  }
  const report = await scanBlocks(pageId, blocks, process.env.PRESIDIO_URL);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
