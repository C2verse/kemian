#!/usr/bin/env node
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Effect, FileSystem, Option, Path, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';

import packageJson from '../../package.json' with { type: 'json' };
import { type BundleSet, decodeBundleSet } from '../protocol/index.ts';
import { buildKnowledgeBase } from './bundler.ts';
import { formatProblems, hasErrors, type Problem } from './problem.ts';
import { PublishError, sendBundleSet } from './publish.ts';

class ProblemsFoundError extends Schema.TaggedError<
  ProblemsFoundError,
  { readonly brand: unique symbol }
>()('ProblemsFoundError', { numErrors: Schema.Int }) {}

const configFlag = Flag.String('config').pipe(
  Flag.withAlias('c'),
  Flag.withDescription('Path of the config file.'),
  Flag.withDefault('kemian.config.ts'),
);
const sourceFlag = Flag.String('source').pipe(
  Flag.withDescription('Identifier of the source, e.g. a commit SHA. Defaults to $GITHUB_SHA.'),
  Flag.optional,
);

const reportProblems = (problems: readonly Problem[]) =>
  Effect.gen(function* () {
    if (problems.length > 0) yield* Console.error(`${formatProblems(problems)}\n`);
    const numErrors = problems.filter((problem) => problem.severity === 'error').length;
    yield* Console.error(`${numErrors} error(s), ${problems.length - numErrors} warning(s)`);
    return yield* hasErrors(problems)
      ? Effect.fail(new ProblemsFoundError({ numErrors }))
      : Effect.void;
  });

const buildWithSource = (config: string, source: Option.Option<string>) => {
  const sourceOrEnvironment = Option.getOrUndefined(source) ?? process.env['GITHUB_SHA'];
  return buildKnowledgeBase({
    configPath: config,
    ...(sourceOrEnvironment === undefined ? {} : { build: { source: sourceOrEnvironment } }),
  });
};

const summarize = (bundleSet: BundleSet) =>
  Effect.forEach(bundleSet.bundles, (bundle) =>
    Console.error(`${bundle.level}: ${bundle.files.length} file(s)`),
  );

const check = Command.make('check', { config: configFlag }, ({ config }) =>
  Effect.gen(function* () {
    const { problems } = yield* buildKnowledgeBase({ configPath: config });
    yield* reportProblems(problems);
  }),
).pipe(Command.withDescription('Checks the privacy markup without writing anything.'));

const build = Command.make(
  'build',
  {
    config: configFlag,
    out: Flag.String('out').pipe(
      Flag.withAlias('o'),
      Flag.withDescription('Path of the bundle set to write.'),
      Flag.withDefault('dist/kemian/bundle-set.json'),
    ),
    source: sourceFlag,
  },
  ({ config, out, source }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { bundleSet, problems } = yield* buildWithSource(config, source);
      yield* fileSystem.makeDirectory(path.dirname(out), { recursive: true });
      yield* fileSystem.writeFileString(out, `${JSON.stringify(bundleSet)}\n`);
      yield* summarize(bundleSet);
      yield* Console.error(`Wrote ${out}`);
      yield* reportProblems(problems);
    }),
).pipe(Command.withDescription('Builds the bundle of every level into one bundle set file.'));

const publish = Command.make(
  'publish',
  {
    config: configFlag,
    url: Flag.String('url').pipe(
      Flag.withDescription('URL of the Kemian server. Defaults to $KEMIAN_URL.'),
      Flag.optional,
    ),
    file: Flag.String('file').pipe(
      Flag.withDescription(
        'Bundle set built earlier with `kemian build`, instead of building now.',
      ),
      Flag.optional,
    ),
    source: sourceFlag,
  },
  ({ config, url, file, source }) =>
    Effect.gen(function* () {
      const { serverUrl, token } = yield* readPublishTarget(url);
      const bundleSet = Option.isSome(file)
        ? yield* readBundleSetFile(file.value)
        : yield* buildForPublishing(config, source);
      yield* sendBundleSet({ url: serverUrl, token, bundleSet });
      yield* summarize(bundleSet);
      yield* Console.error(`Published build ${bundleSet.build.id}`);
    }),
).pipe(Command.withDescription('Builds the bundle set and publishes it to a Kemian server.'));

const readPublishTarget = (url: Option.Option<string>) => {
  const serverUrl = Option.getOrUndefined(url) ?? process.env['KEMIAN_URL'];
  const token = process.env['KEMIAN_PUBLISH_TOKEN'] ?? '';
  if (serverUrl === undefined) {
    return Effect.fail(new PublishError({ reason: 'pass --url or set KEMIAN_URL' }));
  }
  if (token === '') return Effect.fail(new PublishError({ reason: 'set KEMIAN_PUBLISH_TOKEN' }));
  return Effect.succeed({ serverUrl, token });
};

const readBundleSetFile = (path: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const text = yield* fileSystem.readFileString(path);
    const json: unknown = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: () => new PublishError({ reason: `${path} isn't JSON` }),
    });
    return yield* decodeBundleSet(json);
  });

const buildForPublishing = (config: string, source: Option.Option<string>) =>
  Effect.gen(function* () {
    const { bundleSet, problems } = yield* buildWithSource(config, source);
    yield* reportProblems(problems).pipe(
      Effect.tapError(() => Console.error('Refusing to publish a build with errors.')),
    );
    return bundleSet;
  });

const kemian = Command.make('kemian').pipe(
  Command.withDescription('Serves one Markdown knowledge base to different audiences over MCP.'),
  Command.withSubcommands([check, build, publish]),
);

const exitWithFailure = (message?: string) =>
  Effect.gen(function* () {
    if (message !== undefined) yield* Console.error(`error: ${message}`);
    process.exitCode = 1;
  });

Command.run(kemian, { version: packageJson.version }).pipe(
  Effect.catchTags({
    ProblemsFoundError: () => exitWithFailure(),
    ConfigLoadError: (error) => exitWithFailure(error.message),
    InvalidConfigError: (error) => exitWithFailure(error.message),
    PublishError: (error) => exitWithFailure(error.message),
    InvalidBundleError: (error) => exitWithFailure(error.message),
    UnsupportedProtocolError: (error) => exitWithFailure(error.message),
    PlatformError: (error) => exitWithFailure(error.message),
  }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
