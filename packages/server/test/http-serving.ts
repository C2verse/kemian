import { createServer } from 'node:http';

export interface HttpServing {
  readonly url: string;
  readonly close: () => Promise<void>;
}

/**
 * Serves a Fetch API handler on a free local port, for child processes such as the CLI.
 */
export const serveOverHttp = async (
  handler: (request: Request) => Promise<Response>,
): Promise<HttpServing> => {
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
      void handler(
        new Request(`http://127.0.0.1${incoming.url ?? '/'}`, {
          method: incoming.method ?? 'GET',
          headers,
          ...(hasBody ? { body: Buffer.concat(chunks).toString() } : {}),
        }),
      ).then(async (response) => {
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};
