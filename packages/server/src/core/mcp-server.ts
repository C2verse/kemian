import {
  type CallToolResult,
  McpServer,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { Schema } from 'effect';

import type { Bundle, BundleFile, Level } from '../protocol/index.ts';
import type { Identity } from './access.ts';
import { type BundleReader, type FolderEntry, normalizePath } from './bundle-reader.ts';
import { editingInstructions, registerEditingTools } from './editing-tools.ts';
import type { EditorContext } from './editing.ts';
import { textResult, toToolSchema } from './mcp-tool.ts';

/**
 * Tool a deployment adds to the MCP server through {@link Extension.registerTool}.
 */
export interface ExtensionTool<Input extends StandardSchemaWithJSON> {
  readonly name: string;
  readonly description: string;
  /** Input schema, e.g. a zod 4, Valibot, ArkType, or Effect schema with Standard JSON Schema support. */
  readonly input: Input;
  /** Returns the result as text, or as a full MCP tool result. */
  readonly handler: (
    input: StandardSchemaWithJSON.InferOutput<Input>,
  ) => Promise<string | CallToolResult>;
}

/**
 * Facade a deployment's `extend` hook uses to add to the MCP server.
 */
export interface Extension {
  readonly registerTool: <Input extends StandardSchemaWithJSON>(tool: ExtensionTool<Input>) => void;
}

/**
 * Caller a request is served for: the resolved level, its bundle, and the identity, if any.
 */
export interface Caller {
  readonly level: Level;
  readonly bundle: Bundle;
  readonly identity: Identity | undefined;
}

/**
 * Hook that adds deployment-specific tools for each request.
 */
export type ExtendHook = (extension: Extension, caller: Caller) => void | Promise<void>;

const MAX_READ_PATHS = 20;
const MAX_SEARCH_LIMIT = 25;

const ListInput = Schema.Struct({
  path: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Folder to list, e.g. `projects`. Defaults to the root.',
    }),
  ),
});
const ReadInput = Schema.Struct({
  paths: Schema.Array(Schema.String)
    .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_READ_PATHS))
    .annotate({ description: `Paths of the files to read, up to ${MAX_READ_PATHS}.` }),
});
const SearchInput = Schema.Struct({
  query: Schema.NonEmptyString.annotate({ description: 'Keywords to search for.' }),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_SEARCH_LIMIT })).annotate({
      description: `Maximum number of results, up to ${MAX_SEARCH_LIMIT}. Defaults to 10.`,
    }),
  ),
});

/**
 * Builds the MCP server for one request, serving the caller's bundle.
 */
export const buildMcpServer = async (options: {
  readonly name: string;
  readonly version: string;
  readonly reader: BundleReader;
  readonly caller: Caller;
  /** Editor the request is served for, who also gets the editing tools. */
  readonly editor?: EditorContext | undefined;
  readonly extend: ExtendHook | undefined;
}): Promise<McpServer> => {
  const { reader, caller, editor } = options;
  const isEditor = editor !== undefined;
  const server = new McpServer(
    { name: options.name, version: options.version },
    { instructions: instructionsFor(caller, { isEditor }) },
  );
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    'list',
    {
      title: 'List folder',
      description:
        'Lists the folders and files directly inside a folder of the knowledge base, with their summaries. Listing the root also returns the instructions for reading this knowledge base.',
      inputSchema: toToolSchema(ListInput),
      annotations: readOnly,
    },
    async ({ path }) => textResult(listFolder(reader, caller, { path: path ?? '', isEditor })),
  );
  server.registerTool(
    'read',
    {
      title: 'Read files',
      description: 'Reads one or more files of the knowledge base by path, with their metadata.',
      inputSchema: toToolSchema(ReadInput),
      annotations: readOnly,
    },
    async ({ paths }) =>
      textResult(paths.map((path) => readFile(reader, path, { isEditor })).join('\n\n')),
  );
  server.registerTool(
    'search',
    {
      title: 'Search',
      description:
        'Searches the knowledge base by keyword across titles, summaries, paths, and content. Returns the best matches with snippets; read a file for its full content.',
      inputSchema: toToolSchema(SearchInput),
      annotations: readOnly,
    },
    async ({ query, limit }) => textResult(searchFiles(reader, query, limit ?? 10)),
  );

  if (editor !== undefined) registerEditingTools(server, { reader, editor });

  await options.extend?.(
    {
      registerTool: <Input extends StandardSchemaWithJSON>(tool: ExtensionTool<Input>) => {
        server.registerTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(
          tool.name,
          { description: tool.description, inputSchema: tool.input },
          async (input) => {
            const result = await tool.handler(input);
            return typeof result === 'string' ? textResult(result) : result;
          },
        );
      },
    },
    caller,
  );
  return server;
};

const instructionsFor = (caller: Caller, options: { readonly isEditor: boolean }): string =>
  [
    `This server serves a Markdown knowledge base at the "${caller.level}" access level: you see only what that level may see.`,
    'Use `list` to browse folders, `read` to read files, and `search` to find files by keyword.',
    options.isEditor ? editingInstructions() : undefined,
    caller.bundle.instructions,
  ]
    .filter((line) => line !== undefined)
    .join('\n\n');

const listFolder = (
  reader: BundleReader,
  caller: Caller,
  options: { readonly path: string; readonly isEditor: boolean },
): string => {
  const folder = normalizePath(options.path);
  if (reader.isFile(folder)) return `${folder} is a file; use \`read\` to read it.`;
  const entries = reader.list(folder);
  if (entries === undefined) return `Folder not found: ${folder}`;

  const summary = reader.folderSummary(folder);
  const heading = [`# ${folder === '' ? '/' : `${folder}/`}`, summary].filter(
    (line) => line !== undefined,
  );
  const instructions =
    folder === '' ? [instructionsFor(caller, { isEditor: options.isEditor })] : [];
  const lines = entries.length === 0 ? ['(empty)'] : entries.map(formatEntry);
  return [...instructions, heading.join('\n\n'), lines.join('\n')].join('\n\n');
};

const formatEntry = (entry: FolderEntry): string => {
  if (entry.kind === 'folder') {
    return `- ${entry.path}/${entry.summary === undefined ? '' : `: ${entry.summary}`}`;
  }
  const description = [entry.title, entry.summary].filter((part) => part !== undefined).join(' — ');
  return `- ${entry.path}${description === '' ? '' : `: ${description}`}`;
};

const readFile = (
  reader: BundleReader,
  path: string,
  options: { readonly isEditor: boolean },
): string => {
  const file = reader.read(path);
  if (file === undefined) return `# ${normalizePath(path)}\n\nNot found.`;
  const build = options.isEditor ? reader.bundle.build.id : undefined;
  return [`# ${file.path}`, formatMetadata(file, { build }), file.content]
    .filter((part) => part !== '')
    .join('\n\n');
};

const formatMetadata = (
  file: BundleFile,
  options: { readonly build: string | undefined },
): string =>
  [
    ['Title', file.title],
    ['Summary', file.summary],
    ['Updated', file.updated],
    ['Verified', file.verified],
    ['Review due', file.reviewDue],
    ['Build', options.build],
    ['URL', file.url],
    ['Visibility', file.visibility],
    ...Object.entries(file.meta ?? {}).map(
      ([key, value]) => [key, formatMetaValue(value)] as const,
    ),
  ]
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

// A string with a line break stays JSON-encoded, so it can't pass for further metadata lines.
const formatMetaValue = (value: unknown): string =>
  typeof value === 'string' && !/[\n\r]/u.test(value) ? value : JSON.stringify(value);

const searchFiles = (reader: BundleReader, query: string, limit: number): string => {
  const hits = reader.search(query, { limit });
  if (hits.length === 0) return `No matches for "${query}".`;
  return hits
    .map(({ file, snippet }, index) => {
      const heading = `${index + 1}. ${file.path}${file.title === undefined ? '' : ` — ${file.title}`}`;
      return [heading, file.summary, file.url, snippet]
        .filter((line) => line !== undefined && line !== '')
        .join('\n   ');
    })
    .join('\n\n');
};
