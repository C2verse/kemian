import { pathToFileURL } from 'node:url';

import { NodeServices } from '@effect/platform-node';
import { Cause, Effect, Exit, FileSystem, Path, Schema } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

import type { BuildInfo } from '../protocol/index.ts';
import { type BundleSetBuildResult, buildBundleSetFromTree } from './bundle-set-build.ts';
import { InvalidConfigError, type ResolvedConfig, resolveConfig } from './config.ts';
import { readSourceTree } from './source-tree.ts';

/**
 * Error for a config file that can't be found or imported.
 */
export class ConfigLoadError extends Schema.TaggedError<
  ConfigLoadError,
  { readonly brand: unique symbol }
>()('ConfigLoadError', { path: Schema.String, reason: Schema.String }) {
  override get message(): string {
    return `can't load ${this.path}: ${this.reason}`;
  }
}

/**
 * Options for building a knowledge base's bundle set.
 */
export interface BuildOptions {
  /** Path of the config file, relative to the working directory. */
  readonly configPath: string;
  /** Overrides of the build's identification; the ID and time are generated otherwise. */
  readonly build?: Partial<BuildInfo>;
}

/**
 * Loads a config file and resolves the knowledge base's root folder from it.
 */
export const loadConfig = (
  configPath: string,
): Effect.Effect<
  { readonly config: ResolvedConfig; readonly root: string },
  ConfigLoadError | InvalidConfigError | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = path.resolve(configPath);
    if (!(yield* fileSystem.exists(absolutePath))) {
      return yield* new ConfigLoadError({ path: absolutePath, reason: 'file not found' });
    }
    const module = yield* Effect.tryPromise({
      try: (): Promise<unknown> => import(pathToFileURL(absolutePath).href),
      catch: (error) => new ConfigLoadError({ path: absolutePath, reason: String(error) }),
    });
    const exported =
      typeof module === 'object' && module !== null ? Reflect.get(module, 'default') : undefined;
    const config = yield* resolveConfig(exported);
    return { config, root: path.resolve(path.dirname(absolutePath), config.root) };
  });

/**
 * Builds the bundle set of the knowledge base a config file describes.
 */
export const buildKnowledgeBase = (
  options: BuildOptions,
): Effect.Effect<
  BundleSetBuildResult,
  ConfigLoadError | InvalidConfigError | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const { config, root } = yield* loadConfig(options.configPath);
    const tree = yield* readSourceTree(root);
    const source = options.build?.source;
    const build: BuildInfo = {
      id: options.build?.id ?? crypto.randomUUID(),
      createdAt: options.build?.createdAt ?? new Date().toISOString(),
      ...(source === undefined ? {} : { source }),
    };
    return buildBundleSetFromTree({ tree, config, build });
  });

/**
 * Builds the bundle set of the knowledge base a config file describes.
 *
 * @throws {ConfigLoadError} if the config file can't be found or imported
 * @throws {InvalidConfigError} if the config is invalid
 */
export const buildBundleSet = async (options: BuildOptions): Promise<BundleSetBuildResult> => {
  const exit = await Effect.runPromiseExit(
    buildKnowledgeBase(options).pipe(Effect.provide(NodeServices.layer)),
  );
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};
