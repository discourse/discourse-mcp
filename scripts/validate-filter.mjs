import { Logger } from '../dist/util/logger.js';
import { SiteState } from '../dist/site/state.js';
import { registerAllTools } from '../dist/tools/registry.js';

async function main() {
  const logger = new Logger('error');
  const siteState = new SiteState({ logger, timeoutMs: 10000, defaultAuth: { type: 'none' } });

  const tools = {};
  const fakeServer = {
    registerTool(name, _meta, handler) {
      tools[name] = { handler };
    },
  };

  await registerAllTools(fakeServer, siteState, logger, { allowWrites: false, toolsMode: 'discourse_api_only' });

  const selectRes = await tools['discourse_select_site'].handler({ site: 'https://meta.discourse.org' }, {});
  if (selectRes?.isError) throw new Error('select_site failed');

  const filter = 'created-after:7 order:likes';
  const res = await tools['discourse_filter_topics'].handler({ filter, page: 0, per_page: 5 }, {});
  const text = String(res?.content?.[0]?.text || '');
  console.log(text);
}

main().catch((e) => { console.error(e?.message || String(e)); process.exit(1); });

