#!/usr/bin/env node
// Playbook MCP: search AI-made web games, pull open game recipes and game-feel mechanics
// into your own coding agent. Reads the public Playbook API (static JSON on GitHub Pages).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const VERSION = '0.1.2';
const API = (process.env.PLAYBOOK_API || 'https://rexgu9911.github.io/playbook/api').replace(/\/+$/, '');
const TTL = 10 * 60 * 1000;
const MAX_SOURCE = 200_000;
const cache = new Map();

const TIMEOUT = 15_000;
async function fetchOne(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const res = await fetch(url, { headers: { 'user-agent': `playbook-mcp/${VERSION}` }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const v = await res.text();
  cache.set(url, { t: Date.now(), v });
  return v;
}
// Try each URL in order; some networks stall on one host (seen with raw.githubusercontent.com from Node).
async function fetchText(...urls) {
  const errors = [];
  for (const u of urls.flat().filter(Boolean)) {
    try { return await fetchOne(u); } catch (e) { errors.push(`${u}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`); }
  }
  throw new Error(errors.join('; '));
}
const api = async name => JSON.parse(await fetchText(`${API}/${name}.json`));
const isLocalApi = () => /^https?:\/\/(localhost|127\.0\.0\.1)/.test(API);
// When pointed at a local site for testing, read sources from the same server instead of GitHub raw.
const SITE = 'https://rexgu9911.github.io/playbook';
const RAW = 'https://raw.githubusercontent.com/rexgu9911/playbook/main';
const local = u => (isLocalApi() ? u.replace(SITE, API.replace(/\/api$/, '')).replace(RAW, API.replace(/\/api$/, '')) : u);
// Source candidates: the site copy first (same host as the API), then GitHub raw.
const sources = x => [x.source_url, x.source_raw, x.source_url && x.source_url.replace(RAW, SITE)].filter(Boolean).map(local);

const text = t => ({ content: [{ type: 'text', text: t }] });
const fail = t => ({ content: [{ type: 'text', text: t }], isError: true });
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'my', 'me', 'i', 'it', 'is', 'that', 'some', 'add', 'make', 'want', 'like', 'game', 'games', 'please']);
const words = q => String(q || '').toLowerCase().split(/[\s,.;:!?]+/).filter(w => w && !STOP.has(w));
// Words people use for a feel → words our data uses.
const SYN = {
  pause: ['freeze', 'hit-stop', 'hitstop', 'stop'], freeze: ['hit-stop', 'freeze'], impact: ['impact', 'hit'], hitstop: ['hit-stop'],
  juice: ['feel', 'shake', 'particle', 'flash'], feel: ['feel'], shake: ['shake', 'trauma'], screenshake: ['shake'], rumble: ['shake'],
  jump: ['jump', 'platformer', 'coyote'], coyote: ['coyote'], platformer: ['platformer'], movement: ['movement', 'dash', 'jump'],
  explosion: ['burst', 'particle', 'debris'], particles: ['particle', 'burst'], sparks: ['spark', 'burst'],
  dash: ['dash'], trail: ['afterimage', 'trail'], camera: ['camera', 'follow'], follow: ['follow', 'camera'],
  damage: ['damage', 'numbers'], numbers: ['numbers'], crit: ['crit'], loot: ['loot', 'chest', 'reveal'], chest: ['loot', 'capsule'],
  upgrade: ['upgrade', 'level-up', 'cards'], levelup: ['level-up', 'upgrade'], perk: ['upgrade', 'cards'],
  rope: ['grapple', 'rope'], swing: ['grapple', 'swing', 'pendulum'], grapple: ['grapple'],
  fps: ['shooter', 'fps', 'first-person'], shooter: ['shooter', 'shoot'], race: ['racing', 'racer', 'drift'], racing: ['racing'], car: ['racing', 'drift', 'kart'],
};
const variants = w => [w, w.replace(/s$/, ''), ...(SYN[w] || []), ...(SYN[w.replace(/s$/, '')] || [])];
// title/name hits weigh more; every matched query word counts; nothing matched → 0
const score = (strong, weak, ws) => {
  const a = strong.toLowerCase(), b = weak.toLowerCase();
  let s = 0;
  for (const w of ws) {
    const vs = variants(w);
    if (vs.some(v => a.includes(v))) s += 3; else if (vs.some(v => b.includes(v))) s += 1;
  }
  return s;
};
const near = (list, key, q) => list.filter(x => x[key].toLowerCase().includes(String(q).toLowerCase().split('-')[0])).slice(0, 5).map(x => x[key]);
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}\n<!-- truncated: ${s.length - n} more characters at the source URL -->` : s);

const server = new McpServer(
  { name: 'playbook', version: VERSION },
  {
    instructions:
      'Playbook indexes AI-made web games and publishes open recipes (prompt, mechanics, art direction, sound, single-file source) ' +
      'and game-feel mechanics (hit-stop, screen shake, coyote time...). Use search to find things, get_recipe to remake a Playbook game, ' +
      'get_mechanic to add a mechanic to the user\'s game. Games from the web (kind "web") belong to their creators: you may link to them and ' +
      'describe them, but do not copy their code or assets; recreate ideas originally and credit the source.',
  },
);

server.registerTool('search', {
  title: 'Search Playbook',
  description: 'Search Playbook recipes (open, remakeable games), game-feel mechanics, and AI-made games indexed from the web. Returns ids to use with get_recipe / get_mechanic.',
  inputSchema: {
    query: z.string().describe('Words to match, e.g. "racing 3d", "screen shake", "Fable 5.2 shooter". Empty lists everything.').default(''),
    kind: z.enum(['all', 'recipes', 'mechanics', 'web']).default('all').describe('Limit to one kind of result.'),
    limit: z.number().int().min(1).max(30).default(10),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ query, kind, limit }) => {
  try {
    // "a mechanic that...", "game feel for..." → the user wants a mechanic, not games tagged with those words
    if (kind === 'all' && /\bmechanics?\b|\bgame[- ]?feel\b/i.test(query)) kind = 'mechanics';
    const ws = words(query).filter(w => !/^mechanics?$/.test(w));
    const out = [];
    if (kind === 'all' || kind === 'recipes') {
      for (const r of await api('recipes')) {
        const s = ws.length ? score([r.title, r.id, r.genres.join(' ')].join(' '), [r.engine, r.art_direction, r.kind, r.prompt, r.mechanics.map(m => `${m.name} ${m.slug}`).join(' ')].join(' '), ws) : 1;
        if (s) out.push({ s: s + (r.kind === 'original' ? 0.5 : 0), line: `- [recipe] **${r.title}** (id: \`${r.id}\`) · ${r.kind}${r.remix_of ? ` of ${r.remix_of}` : ''} · ${r.genres.join(', ')} · ${r.engine} · ${r.art_direction}` });
      }
    }
    if (kind === 'all' || kind === 'mechanics') {
      for (const m of await api('mechanics')) {
        const s = ws.length ? score([m.name, m.slug, m.category].join(' '), [m.description, m.prompt].join(' '), ws) : 1;
        if (s) out.push({ s: s + 0.6, line: `- [mechanic] **${m.name}** (slug: \`${m.slug}\`) · ${m.category} · ${m.description}` });
      }
    }
    if (kind === 'all' || kind === 'web') {
      for (const d of await api('discover')) {
        const s = ws.length ? score([d.title, d.genre].join(' '), [d.creator, d.engine, d.model, d.platform, d.note, d.is3d ? '3d' : ''].join(' '), ws) : 1;
        if (s) out.push({ s, line: `- [web] **${d.title}** by ${d.creator || 'unknown'} · ${[d.genre, d.engine, d.model].filter(Boolean).join(' · ')} · play: ${d.url} · shared: ${d.source} · ${d.note}` });
      }
    }
    out.sort((a, b) => b.s - a.s);
    if (out.length && ws.length > 1) {
      const floor = Math.max(1, out[0].s * 0.4);
      for (let k = out.length - 1; k >= 0; k--) if (out[k].s < floor) out.splice(k, 1);
    }
    if (!out.length) return text(`No matches for "${query}". Try a genre (racing, shooter, puzzle), an engine (three.js), or a feel ("hit stop").`);
    const shown = out.slice(0, limit);
    return text(`${out.length} match${out.length > 1 ? 'es' : ''}${out.length > limit ? `, showing ${limit}` : ''}:\n${shown.map(x => x.line).join('\n')}\n\n` +
      'Recipes and mechanics are open (MIT): use get_recipe / get_mechanic. [web] games belong to their creators: link and credit only.');
  } catch (e) { return fail(`Could not reach the Playbook API (${API}): ${e.message}`); }
});

server.registerTool('get_recipe', {
  title: 'Get a game recipe',
  description: 'Everything that made a Playbook game: the original prompt, mechanics, art direction, palette, sound, controls, and optionally the full single-file source. Use it to remake the game in the user\'s own project with a new theme.',
  inputSchema: {
    id: z.string().describe('Recipe id from search, e.g. "neon-drift" or "swarm-arena-1".'),
    include_source: z.boolean().default(false).describe('Also return the full HTML source (20-40 KB). Useful as a reference implementation.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ id, include_source }) => {
  try {
    const recipes = await api('recipes');
    const r = recipes.find(x => x.id === id) || recipes.find(x => x.title.toLowerCase() === String(id).toLowerCase());
    if (!r) return fail(`No recipe "${id}". Close matches: ${near(recipes, 'id', id).join(', ') || 'none'}. Use search to find ids.`);
    const parent = r.remix_of ? recipes.find(x => x.id === r.remix_of) : null;
    const remixes = recipes.filter(x => x.remix_of === (r.remix_of || r.id) && x.id !== r.id).map(x => `${x.title} (\`${x.id}\`): ${x.art_direction}`);
    let src = '';
    if (include_source) src = truncate(await fetchText(sources(r)), MAX_SOURCE);
    return text([
      `# ${r.title}  (\`${r.id}\`)`,
      `${r.kind === 'remix' ? `Remix of **${parent?.title || r.remix_of}**` : 'Original'} · ${r.genres.join(', ')} · ${r.engine} · ${r.files} HTML file · license ${r.license}`,
      '',
      `**Prompt that made it**\n${r.prompt}`,
      '',
      `**Mechanics** (get each with get_mechanic): ${r.mechanics.map(m => `${m.name} (\`${m.slug}\`)`).join(', ')}`,
      `**Art direction:** ${r.art_direction} · palette ${r.palette.join(', ')}`,
      `**Sound:** ${r.sound}`,
      `**Controls:** ${r.controls}`,
      '',
      `Play: ${r.play_url}\nPage: ${r.page_url}\nSource (raw): ${r.source_raw || r.source_url}${r.theme_param ? ` (this version is \`?${r.theme_param}\`)` : ''}`,
      remixes.length ? `\n**Other versions:** ${remixes.join(' · ')}` : '',
      '',
      '**How to remake it**: keep the mechanics and the feel (timings, juice), change the theme, palette, hero and sound to the user\'s idea. ' +
      'Build it as one self-contained HTML file unless the user\'s project says otherwise, and credit the original: ' +
      `"Remix of ${parent?.title || r.title} from Playbook (${r.page_url})".`,
      src ? `\n**Source (${r.source_url})**\n\`\`\`html\n${src}\n\`\`\`` : '',
    ].filter(x => x !== '').join('\n'));
  } catch (e) { return fail(`Could not load recipe "${id}": ${e.message}`); }
});

server.registerTool('get_mechanic', {
  title: 'Get a game-feel mechanic',
  description: 'A game-feel mechanic (hit-stop, screen shake, coyote time, damage numbers...) with a prompt and a small, working reference implementation to adapt into the user\'s game.',
  inputSchema: {
    slug: z.string().describe('Mechanic slug from search or list, e.g. "hit-stop" or "screen-shake".'),
    include_source: z.boolean().default(true).describe('Return the reference implementation (a 6-10 KB single HTML demo).'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ slug, include_source }) => {
  try {
    const mechanics = await api('mechanics');
    const m = mechanics.find(x => x.slug === slug) || mechanics.find(x => x.name.toLowerCase() === String(slug).toLowerCase());
    if (!m) return fail(`No mechanic "${slug}". Available: ${mechanics.map(x => x.slug).join(', ')}.`);
    let src = '';
    if (include_source) src = truncate(await fetchText(sources(m)), MAX_SOURCE);
    return text([
      `# ${m.name}  (\`${m.slug}\`) · ${m.category}`,
      m.description,
      '',
      `**Prompt**\n${m.prompt}`,
      '',
      `Works with: ${m.works_with.join(', ')} · license ${m.license}`,
      m.used_by.length ? `Used in recipes: ${m.used_by.join(', ')}` : '',
      `Live demo: ${m.demo_url}\nSource (raw): ${m.source_raw || m.source_url}`,
      '',
      '**How to add it**: find the user\'s game loop and the event that should trigger it, port only the relevant logic and constants from the reference ' +
      '(not the demo scaffolding), keep the timings, and expose the key numbers as named constants so they can be tuned. ' +
      'Check the draw code as well as the update code: visual states (flashes, holds, jitter) are often decided at render time. ' +
      'The prompt above states the intended behaviour and timings; if it and the reference ever disagree, follow the prompt.',
      src ? `\n**Reference implementation**\n\`\`\`html\n${src}\n\`\`\`` : '',
    ].filter(x => x !== '').join('\n'));
  } catch (e) { return fail(`Could not load mechanic "${slug}": ${e.message}`); }
});

server.registerTool('list', {
  title: 'List recipes or mechanics',
  description: 'List every Playbook recipe or every mechanic, optionally filtered by genre (recipes) or category (mechanics).',
  inputSchema: {
    what: z.enum(['recipes', 'mechanics']).default('mechanics'),
    filter: z.string().default('').describe('Genre for recipes (e.g. "Racing") or category for mechanics (e.g. "Feel").'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ what, filter }) => {
  try {
    const f = filter.toLowerCase();
    if (what === 'recipes') {
      const rs = (await api('recipes')).filter(r => !f || r.genres.some(g => g.toLowerCase() === f));
      return text(rs.map(r => `- **${r.title}** (\`${r.id}\`) · ${r.kind} · ${r.genres.join(', ')} · ${r.art_direction}`).join('\n') || 'No recipes match.');
    }
    const ms = (await api('mechanics')).filter(m => !f || m.category.toLowerCase() === f);
    return text(ms.map(m => `- **${m.name}** (\`${m.slug}\`) · ${m.category} · ${m.description}`).join('\n') || 'No mechanics match.');
  } catch (e) { return fail(`Could not reach the Playbook API (${API}): ${e.message}`); }
});

server.registerPrompt('remake', {
  title: 'Remake a Playbook game',
  description: 'Remake a Playbook recipe with your own theme.',
  argsSchema: {
    id: z.string().describe('Recipe id, e.g. neon-drift'),
    theme: z.string().describe('Your twist, e.g. "underwater, a tiny submarine"'),
  },
}, ({ id, theme }) => ({
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: `Use the playbook get_recipe tool for "${id}" (with include_source true). Remake it as a single HTML file with this theme: ${theme}. ` +
        'Keep the mechanics and their timings, change the art direction, palette, hero and sound to fit the theme, and add a credit line linking the original recipe.',
    },
  }],
}));

await server.connect(new StdioServerTransport());
