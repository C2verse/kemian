import { kemian, r2BundleStore } from '@kemian/server/cloudflare';

export default kemian((env: Env) => ({
  store: r2BundleStore(env.BUNDLES),
  anonymous: 'public',
  publishToken: env.KEMIAN_PUBLISH_TOKEN,
  fallback: () =>
    new Response('Kemian demo. Connect an MCP client to /mcp.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }),
}));
