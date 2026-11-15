import { Effect, Schema } from 'effect';

/**
 * Error for a GitHub API request that failed.
 */
export class GitHubError extends Schema.TaggedError<
  GitHubError,
  { readonly brand: unique symbol }
>()('GitHubError', { reason: Schema.String }) {
  override get message(): string {
    return `GitHub request failed: ${this.reason}`;
  }
}

/**
 * Change to one file of a repository, by path from the repository root: its new text, or `null` to delete it.
 */
export interface RepositoryChange {
  readonly path: string;
  readonly text: string | null;
}

/**
 * GitHub repository that `kemian proposals pull` commits to and opens pull requests on.
 */
export interface GitHubRepository {
  /** Name of the default branch. */
  readonly defaultBranch: Effect.Effect<string, GitHubError>;
  /** Creates a commit on top of `parent` with the changes, returning its SHA. */
  readonly commit: (options: {
    readonly parent: string;
    readonly message: string;
    readonly changes: readonly RepositoryChange[];
  }) => Effect.Effect<string, GitHubError>;
  /** Points a branch at a commit, creating it or moving it there. */
  readonly pushBranch: (branch: string, sha: string) => Effect.Effect<void, GitHubError>;
  /** Moves a branch forward to a commit, returning `false` when GitHub refuses, e.g. for a protected branch. */
  readonly fastForward: (branch: string, sha: string) => Effect.Effect<boolean, GitHubError>;
  /** Opens a pull request, or updates the open one from the same branch, returning its URL. */
  readonly openPullRequest: (options: {
    readonly branch: string;
    readonly base: string;
    readonly title: string;
    readonly body: string;
  }) => Effect.Effect<string, GitHubError>;
  /** Sets a commit status. */
  readonly setStatus: (options: {
    readonly sha: string;
    readonly context: string;
    readonly state: 'success' | 'failure';
    readonly description: string;
  }) => Effect.Effect<void, GitHubError>;
}

interface GitHubResponse {
  readonly status: number;
  readonly body: unknown;
}

const MAX_STATUS_DESCRIPTION = 140;

/**
 * Creates a client for a GitHub repository, e.g. with the `GITHUB_TOKEN` of a GitHub Actions job.
 */
export const makeGitHubRepository = (options: {
  /** Repository as `owner/name`. */
  readonly repo: string;
  readonly token: string;
  /** Defaults to `https://api.github.com`. */
  readonly apiUrl?: string;
  readonly fetch?: typeof fetch;
}): GitHubRepository => {
  const apiUrl = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/u, '');
  const send = options.fetch ?? fetch;
  const owner = options.repo.split('/')[0] ?? '';

  const request = (method: string, path: string, body?: unknown) =>
    Effect.gen(function* () {
      const url = `${apiUrl}/repos/${options.repo}${path}`;
      const response = yield* Effect.tryPromise({
        try: () =>
          send(url, {
            method,
            headers: {
              'accept': 'application/vnd.github+json',
              'authorization': `Bearer ${options.token}`,
              'user-agent': 'kemian',
              'x-github-api-version': '2022-11-28',
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        catch: (error) => new GitHubError({ reason: `can't reach ${url}: ${String(error)}` }),
      });
      const json: unknown = yield* Effect.tryPromise(() => response.json()).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      return { status: response.status, body: json } satisfies GitHubResponse;
    });

  const failWith = (method: string, path: string, response: GitHubResponse) =>
    failureOf(method, `/repos/${options.repo}${path}`, response);

  const requestOk = (method: string, path: string, body?: unknown) =>
    Effect.gen(function* () {
      const response = yield* request(method, path, body);
      if (response.status >= 200 && response.status < 300) return response.body;
      return yield* failWith(method, path, response);
    });

  return {
    defaultBranch: Effect.gen(function* () {
      return yield* readStringAt(yield* requestOk('GET', ''), ['default_branch'], 'default branch');
    }),

    commit: ({ parent, message, changes }) =>
      Effect.gen(function* () {
        const parentCommit = yield* requestOk('GET', `/git/commits/${parent}`);
        const baseTree = yield* readStringAt(parentCommit, ['tree', 'sha'], 'tree SHA');
        const tree = yield* requestOk('POST', '/git/trees', {
          base_tree: baseTree,
          tree: changes.map((change) =>
            change.text === null
              ? { path: change.path, mode: '100644', type: 'blob', sha: null }
              : { path: change.path, mode: '100644', type: 'blob', content: change.text },
          ),
        });
        const treeSha = yield* readStringAt(tree, ['sha'], 'tree SHA');
        const commit = yield* requestOk('POST', '/git/commits', {
          message,
          tree: treeSha,
          parents: [parent],
        });
        return yield* readStringAt(commit, ['sha'], 'commit SHA');
      }),

    pushBranch: (branch, sha) =>
      Effect.gen(function* () {
        const created = yield* request('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha });
        if (created.status !== 201 && created.status !== 422) {
          return yield* failWith('POST', '/git/refs', created);
        }
        if (created.status === 422) {
          yield* requestOk('PATCH', `/git/refs/heads/${branch}`, { sha, force: true });
        }
        return undefined;
      }),

    fastForward: (branch, sha) =>
      Effect.gen(function* () {
        const response = yield* request('PATCH', `/git/refs/heads/${branch}`, {
          sha,
          force: false,
        });
        if (response.status >= 200 && response.status < 300) return true;
        if ([403, 409, 422].includes(response.status)) return false;
        return yield* failWith('PATCH', `/git/refs/heads/${branch}`, response);
      }),

    openPullRequest: ({ branch, base, title, body }) =>
      Effect.gen(function* () {
        const created = yield* request('POST', '/pulls', { title, head: branch, base, body });
        if (created.status === 201) return yield* readStringAt(created.body, ['html_url'], 'URL');
        if (created.status !== 422) return yield* failWith('POST', '/pulls', created);
        const open = yield* requestOk(
          'GET',
          `/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
        );
        const number = yield* readStringAt(open, ['0', 'number'], 'open pull request');
        const updated = yield* requestOk('PATCH', `/pulls/${number}`, { title, body });
        return yield* readStringAt(updated, ['html_url'], 'URL');
      }),

    setStatus: ({ sha, context, state, description }) =>
      requestOk('POST', `/statuses/${sha}`, {
        state,
        context,
        description: description.slice(0, MAX_STATUS_DESCRIPTION),
      }).pipe(Effect.asVoid),
  };
};

const readStringAt = (value: unknown, keys: readonly string[], what: string) => {
  let current = value;
  for (const key of keys) {
    current =
      typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined;
  }
  return typeof current === 'string' || typeof current === 'number'
    ? Effect.succeed(String(current))
    : Effect.fail(new GitHubError({ reason: `GitHub's answer has no ${what}` }));
};

const failureOf = (method: string, path: string, response: GitHubResponse) => {
  const message =
    typeof response.body === 'object' && response.body !== null
      ? Reflect.get(response.body, 'message')
      : undefined;
  return Effect.fail(
    new GitHubError({
      reason: `${method} ${path} answered ${response.status}${typeof message === 'string' ? `: ${message}` : ''}`,
    }),
  );
};
