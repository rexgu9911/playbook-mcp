// End-to-end check: spawn the server over stdio with the official MCP client and call every tool.
//   node test.mjs                       (live API)
//   PLAYBOOK_API=http://localhost:4392/api node test.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: process.execPath, args: ['index.js'], env: { ...process.env } });
const client = new Client({ name: 'playbook-test', version: '0.0.0' });
await client.connect(transport);

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { err: !!r.isError, t: r.content.map(c => c.text).join('\n') };
};

const { tools } = await client.listTools();
check('lists 4 tools', ['search', 'get_recipe', 'get_mechanic', 'list'].every(n => tools.some(t => t.name === n)), tools.map(t => t.name).join(', '));
const { prompts } = await client.listPrompts();
check('lists remake prompt', prompts.some(p => p.name === 'remake'));

let r = await call('search', { query: 'racing' });
check('search racing finds recipe + web', !r.err && r.t.includes('[recipe]') && r.t.includes('[web]'), r.t.split('\n')[0]);
r = await call('search', { query: 'shake', kind: 'mechanics' });
check('search mechanics', !r.err && r.t.includes('screen-shake'));
r = await call('search', { query: 'higgsfield', kind: 'web' });
check('search web: higgsfield', !r.err && /Sunwarden|Iron Bamboo|Saltfire/.test(r.t), r.t.split('\n')[0]);
r = await call('search', { query: 'impact pause' });
check('natural words find hit-stop first', !r.err && r.t.split('\n')[1]?.includes('hit-stop'), r.t.split('\n')[1]);
r = await call('search', { query: 'a mechanic that pauses the action on impact' });
check('long query: hit-stop first, short tail', !r.err && r.t.split('\n')[1]?.includes('hit-stop') && r.t.split('\n').filter(l => l.startsWith('- ')).length <= 6, r.t.split('\n')[0]);
r = await call('search', { query: 'juice for my platformer jump', kind: 'mechanics' });
check('natural words find platformer controller', !r.err && r.t.includes('platformer-controller'));
r = await call('search', { query: 'zzzz-nothing' });
check('search no match is friendly', !r.err && r.t.startsWith('No matches'));

r = await call('get_recipe', { id: 'neon-drift' });
check('get_recipe has prompt + mechanics', !r.err && r.t.includes('Prompt that made it') && r.t.includes('screen-shake'));
r = await call('get_recipe', { id: 'swarm-arena-1', include_source: true });
check('get_recipe remix + source', !r.err && r.t.includes('Remix of') && r.t.includes('<html') , `${r.t.length} chars`);
r = await call('get_recipe', { id: 'neon' });
check('get_recipe unknown id suggests', r.err && r.t.includes('neon-drift'));

r = await call('get_mechanic', { slug: 'hit-stop' });
check('get_mechanic with source', !r.err && r.t.includes('Reference implementation') && r.t.includes('<script'), `${r.t.length} chars`);
r = await call('get_mechanic', { slug: 'nope' });
check('get_mechanic unknown lists slugs', r.err && r.t.includes('hit-stop'));

r = await call('list', { what: 'recipes', filter: 'Racing' });
check('list recipes by genre', !r.err && r.t.includes('Neon Drift'));
r = await call('list', { what: 'mechanics' });
check('list mechanics', !r.err && r.t.split('\n').length >= 10);

const pr = await client.getPrompt({ name: 'remake', arguments: { id: 'neon-drift', theme: 'underwater' } });
check('remake prompt renders', pr.messages[0].content.text.includes('neon-drift'));

await client.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
