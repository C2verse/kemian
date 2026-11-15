import { kemian, r2BundleStore, r2ProposalStore } from '@kemian/server/cloudflare';
import { githubSignIn } from '@kemian/server/github';

const listOf = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

export default kemian((env: Env) => ({
  store: r2BundleStore(env.BUNDLES),
  anonymous: 'public',
  levels: { private: listOf(env.PRIVATE_IDENTITIES) },
  publishToken: env.KEMIAN_PUBLISH_TOKEN,
  editing: {
    proposals: r2ProposalStore(env.BUNDLES),
    editors: listOf(env.EDITOR_IDENTITIES),
    proposalsToken: env.KEMIAN_PROPOSALS_TOKEN,
  },
  ...(env.GITHUB_CLIENT_ID === '' || !env.GITHUB_CLIENT_SECRET
    ? {}
    : {
        signIn: githubSignIn({
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          baseUrl: env.GITHUB_BASE_URL,
          apiBaseUrl: env.GITHUB_API_BASE_URL,
        }),
      }),
  fallback: () =>
    new Response('Kemian demo. Connect an MCP client to /mcp.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }),
}));
