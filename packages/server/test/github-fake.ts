import { type HttpServing, serveOverHttp } from './http-serving.ts';

export interface FakeCommit {
  readonly sha: string;
  readonly message: string;
  readonly parents: readonly string[];
  readonly files: ReadonlyMap<string, string>;
}

export interface FakePullRequest {
  readonly number: number;
  title: string;
  readonly head: string;
  readonly base: string;
  body: string;
  readonly htmlUrl: string;
}

export interface FakeStatus {
  readonly sha: string;
  readonly state: string;
  readonly context: string;
  readonly description: string;
}

/**
 * In-memory model of the GitHub REST endpoints `kemian proposals pull` uses.
 */
export class FakeGitHub {
  readonly repo: string;
  readonly token: string;
  readonly defaultBranch = 'main';
  readonly commits = new Map<string, FakeCommit>();
  readonly refs = new Map<string, string>();
  readonly pulls: FakePullRequest[] = [];
  readonly statuses: FakeStatus[] = [];
  readonly requests: string[] = [];
  isDefaultBranchProtected = false;
  /** Branches whose pull requests GitHub refuses with a server error. */
  readonly branchesFailing = new Set<string>();
  readonly #trees = new Map<string, ReadonlyMap<string, string>>();
  #numShas = 0;

  constructor(options: {
    readonly repo: string;
    readonly token: string;
    readonly files: Readonly<Record<string, string>>;
  }) {
    this.repo = options.repo;
    this.token = options.token;
    const files = new Map(Object.entries(options.files));
    this.#trees.set('tree-base', files);
    this.commits.set('base', { sha: 'base', message: 'initial', parents: [], files });
    this.refs.set(this.defaultBranch, 'base');
  }

  /** Returns the files of a branch's head commit. */
  filesOf(branch: string): ReadonlyMap<string, string> {
    const sha = this.refs.get(branch);
    const commit = sha === undefined ? undefined : this.commits.get(sha);
    if (commit === undefined) throw new Error(`no branch ${branch}`);
    return commit.files;
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    this.handle(new Request(input, init));

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const prefix = `/repos/${this.repo}`;
    this.requests.push(`${request.method} ${url.pathname}`);
    if (request.headers.get('authorization') !== `Bearer ${this.token}`) {
      return Response.json({ message: 'Bad credentials' }, { status: 401 });
    }
    if (!url.pathname.startsWith(prefix)) return notFound();
    const path = url.pathname.slice(prefix.length);
    const body: unknown = request.method === 'GET' ? undefined : await request.json();
    const route = `${request.method} ${path.replace(/\/[^/]+$/u, '/:id')}`;

    if (request.method === 'GET' && path === '') {
      return Response.json({ default_branch: this.defaultBranch });
    }
    if (route === 'GET /git/commits/:id') {
      const commit = this.commits.get(lastSegmentOf(path));
      return commit === undefined
        ? notFound()
        : Response.json({ sha: commit.sha, tree: { sha: this.#treeShaOf(commit) } });
    }
    if (request.method === 'POST' && path === '/git/trees') return this.#createTree(body);
    if (request.method === 'POST' && path === '/git/commits') return this.#createCommit(body);
    if (request.method === 'POST' && path === '/git/refs') return this.#createRef(body);
    if (request.method === 'PATCH' && path.startsWith('/git/refs/heads/')) {
      return this.#updateRef(path.slice('/git/refs/heads/'.length), body);
    }
    if (request.method === 'POST' && path === '/pulls') return this.#createPull(body);
    if (request.method === 'GET' && path === '/pulls') {
      const head = url.searchParams.get('head')?.split(':')[1];
      return Response.json(
        this.pulls.filter((pull) => pull.head === head).map((pull) => ({ number: pull.number })),
      );
    }
    if (route === 'PATCH /pulls/:id') {
      const pull = this.pulls.find((each) => String(each.number) === lastSegmentOf(path));
      if (pull === undefined) return notFound();
      pull.title = readString(body, 'title') ?? pull.title;
      pull.body = readString(body, 'body') ?? pull.body;
      return Response.json({ number: pull.number, html_url: pull.htmlUrl });
    }
    if (route === 'POST /statuses/:id') {
      this.statuses.push({
        sha: lastSegmentOf(path),
        state: readString(body, 'state') ?? '',
        context: readString(body, 'context') ?? '',
        description: readString(body, 'description') ?? '',
      });
      return Response.json({}, { status: 201 });
    }
    return notFound();
  }

  /** Serves the fake over HTTP, for child processes. */
  listen(): Promise<HttpServing> {
    return serveOverHttp((request) => this.handle(request));
  }

  #createTree(body: unknown): Response {
    const base = this.#trees.get(readString(body, 'base_tree') ?? '');
    if (base === undefined) return Response.json({ message: 'no base tree' }, { status: 422 });
    const files = new Map(base);
    const entries: unknown = Reflect.get(Object(body), 'tree');
    for (const entry of Array.isArray(entries) ? entries : []) {
      const path = readString(entry, 'path') ?? '';
      const content = readString(entry, 'content');
      if (content === undefined) files.delete(path);
      else files.set(path, content);
    }
    const sha = this.#nextSha('tree');
    this.#trees.set(sha, files);
    return Response.json({ sha }, { status: 201 });
  }

  #createCommit(body: unknown): Response {
    const files = this.#trees.get(readString(body, 'tree') ?? '');
    const parents: unknown = Reflect.get(Object(body), 'parents');
    if (files === undefined || !Array.isArray(parents)) return notFound();
    const sha = this.#nextSha('commit');
    this.commits.set(sha, {
      sha,
      message: readString(body, 'message') ?? '',
      parents: parents.map(String),
      files,
    });
    return Response.json({ sha }, { status: 201 });
  }

  #createRef(body: unknown): Response {
    const branch = (readString(body, 'ref') ?? '').replace('refs/heads/', '');
    if (this.refs.has(branch)) {
      return Response.json({ message: 'Reference already exists' }, { status: 422 });
    }
    this.refs.set(branch, readString(body, 'sha') ?? '');
    return Response.json({}, { status: 201 });
  }

  #updateRef(branch: string, body: unknown): Response {
    const sha = readString(body, 'sha') ?? '';
    const current = this.refs.get(branch);
    if (current === undefined) return notFound();
    if (branch === this.defaultBranch && this.isDefaultBranchProtected) {
      return Response.json({ message: 'Protected branch update failed' }, { status: 422 });
    }
    const isForced = Reflect.get(Object(body), 'force') === true;
    if (!isForced && !this.commits.get(sha)?.parents.includes(current)) {
      return Response.json({ message: 'Update is not a fast forward' }, { status: 422 });
    }
    this.refs.set(branch, sha);
    return Response.json({});
  }

  #createPull(body: unknown): Response {
    const head = readString(body, 'head') ?? '';
    if (this.branchesFailing.has(head)) {
      return Response.json({ message: 'Server Error' }, { status: 500 });
    }
    if (this.pulls.some((pull) => pull.head === head)) {
      return Response.json({ message: 'A pull request already exists' }, { status: 422 });
    }
    const number = this.pulls.length + 1;
    const pull = {
      number,
      title: readString(body, 'title') ?? '',
      head,
      base: readString(body, 'base') ?? '',
      body: readString(body, 'body') ?? '',
      htmlUrl: `https://github.com/${this.repo}/pull/${number}`,
    };
    this.pulls.push(pull);
    return Response.json({ number, html_url: pull.htmlUrl }, { status: 201 });
  }

  #treeShaOf(commit: FakeCommit): string {
    for (const [sha, files] of this.#trees) if (files === commit.files) return sha;
    throw new Error(`no tree for ${commit.sha}`);
  }

  #nextSha(kind: string): string {
    this.#numShas++;
    return `${kind}-${this.#numShas}`;
  }
}

const notFound = () => Response.json({ message: 'Not Found' }, { status: 404 });

const lastSegmentOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const readString = (value: unknown, key: string): string | undefined => {
  const field: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  return typeof field === 'string' ? field : undefined;
};
