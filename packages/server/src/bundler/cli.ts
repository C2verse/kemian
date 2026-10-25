#!/usr/bin/env node
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Effect, FileSystem, Option, Path, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';

import packageJson from '../../package.json' with { type: 'json' };
import { buildKnowledgeBase } from './bundler.ts';
import { formatProblems, hasErrors, type Problem } from './problem.ts';

class ProblemsFoundError extends Schema.TaggedError<
  ProblemsFoundError,
  { readonly brand: unique symbol }
>()('ProblemsFoundError', { numErrors: Schema.Int }) {}

const configFlag = Flag.String('config').pipe(
  Flag.withAlias('c'),
  Flag.withDescription('Path of the config file.'),
  Flag.withDefault('kemian.config.ts'),
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
    source: Flag.String('source').pipe(
      Flag.withDescription('Identifier of the source, e.g. a commit SHA. Defaults to $GITHUB_SHA.'),
      Flag.optional,
    ),
  },
  ({ config, out, source }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceOrEnvironment = Option.getOrUndefined(source) ?? process.env['GITHUB_SHA'];
      const { bundleSet, problems } = yield* buildKnowledgeBase({
        configPath: config,
        ...(sourceOrEnvironment === undefined ? {} : { build: { source: sourceOrEnvironment } }),
      });
      yield* fileSystem.makeDirectory(path.dirname(out), { recursive: true });
      yield* fileSystem.writeFileString(out, `${JSON.stringify(bundleSet)}\n`);
      for (const bundle of bundleSet.bundles) {
        yield* Console.error(`${bundle.level}: ${bundle.files.length} file(s)`);
      }
      yield* Console.error(`Wrote ${out}`);
      yield* reportProblems(problems);
    }),
).pipe(Command.withDescription('Builds the bundle of every level into one bundle set file.'));

const kemian = Command.make('kemian').pipe(
  Command.withDescription('Serves one Markdown knowledge base to different audiences over MCP.'),
  Command.withSubcommands([check, build]),
);

Command.run(kemian, { version: packageJson.version }).pipe(
  Effect.catchTag('ProblemsFoundError', () =>
    Effect.sync(() => {
      process.exitCode = 1;
    }),
  ),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
