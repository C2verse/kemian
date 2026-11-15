import { Effect, Schema, SchemaIssue } from 'effect';

import { Level } from '../protocol/index.ts';

/**
 * File the bundler is about to put into a level's bundle, as seen by {@link KemianConfig.filter}.
 */
export interface BundleFileCandidate {
  readonly level: string;
  readonly path: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
}

/**
 * Configuration of the Markdown bundler, usually the default export of `kemian.config.ts`.
 */
export interface KemianConfig {
  /** Access levels, lowest first. Each level sees everything the levels below it see. */
  readonly levels: readonly string[];
  /** Folder of the knowledge base, relative to the config file. Defaults to the config file's folder. */
  readonly root?: string;
  /** Globs of files to bundle, relative to the root. Defaults to `['**\/*.md']`. */
  readonly include?: readonly string[];
  /** Globs of files to leave out of every bundle; a later `!glob` brings files back. */
  readonly exclude?: readonly string[];
  /** Level of files and folders that declare none. Defaults to the highest level. */
  readonly defaultVisibility?: string;
  readonly frontmatter?: {
    /** Frontmatter key that declares a file's or folder's level. Defaults to `visibility`. */
    readonly visibility?: string;
    /** Defaults to `summary`. */
    readonly summary?: string;
    /** Defaults to `title`; without it, a file's first level-1 heading is its title. */
    readonly title?: string;
    /** Defaults to `updated`. */
    readonly updated?: string;
    /** Frontmatter key of the date a file was last confirmed true. Defaults to `verified`. */
    readonly verified?: string;
    /** Frontmatter key of a file's status, e.g. `stable`. Defaults to `status`. */
    readonly status?: string;
    /** Frontmatter keys copied into each file's `meta`. */
    readonly keep?: readonly string[];
  };
  /** Whether bundles keep the tags around content they may see. Defaults to `keep`. */
  readonly markers?: 'keep' | 'strip';
  /** Whether each bundle ships a prebuilt search index, so servers don't build one. Defaults to `true`. */
  readonly searchIndex?: boolean;
  /** File with each level's instructions for agents, relative to the root. */
  readonly instructions?: Readonly<Record<string, string>>;
  /** Returns whether a file goes into a level's bundle; it can only leave files out. */
  readonly filter?: (file: BundleFileCandidate) => boolean;
  /** Returns the URL where people can read a file, if any. */
  readonly url?: (file: { readonly level: string; readonly path: string }) => string | undefined;
  readonly review?: {
    /**
     * Days after its verified (else updated) date that a file of each status is due for review, e.g.
     * `{ evolving: 30, stable: 180 }`. Files of other statuses are never due.
     */
    readonly intervals: Readonly<Record<string, number>>;
  };
  /** How `kemian proposals pull` applies proposals from agents. */
  readonly proposals?: {
    /** Folder new notes go in, relative to the root. Defaults to `inbox`. */
    readonly notes?: string;
    /** Status an obsolete file gets when it's archived. Defaults to `archived`. */
    readonly archivedStatus?: string;
    /** Whether an obsolete note is deleted or archived like other files. Defaults to `delete`. */
    readonly obsoleteNotes?: 'delete' | 'archive';
  };
}

/**
 * Bundler configuration with defaults applied and values validated.
 */
export interface ResolvedConfig {
  readonly levels: readonly Level[];
  readonly root: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly defaultVisibility: Level;
  readonly frontmatterKeys: {
    readonly visibility: string;
    readonly summary: string;
    readonly title: string;
    readonly updated: string;
    readonly verified: string;
    readonly status: string;
  };
  readonly keep: readonly string[];
  readonly markers: 'keep' | 'strip';
  readonly searchIndex: boolean;
  readonly instructions: ReadonlyMap<Level, string>;
  readonly filter: (file: BundleFileCandidate) => boolean;
  readonly url: (file: { readonly level: string; readonly path: string }) => string | undefined;
  readonly reviewIntervals: ReadonlyMap<string, number>;
  readonly proposals: {
    readonly notesFolder: string;
    readonly archivedStatus: string;
    readonly obsoleteNotes: 'delete' | 'archive';
  };
}

/**
 * Error for a bundler configuration that can't be used.
 */
export class InvalidConfigError extends Schema.TaggedError<
  InvalidConfigError,
  { readonly brand: unique symbol }
>()('InvalidConfigError', { reason: Schema.String }) {
  override get message(): string {
    return `invalid Kemian config: ${this.reason}`;
  }
}

/**
 * Returns the configuration unchanged, typed for editors.
 */
export const defineConfig = (config: KemianConfig): KemianConfig => config;

const isRelativeFolderPath = (path: string): boolean =>
  !path.includes('\\') &&
  path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

const ConfigData = Schema.Struct({
  levels: Schema.NonEmptyArray(Level),
  root: Schema.optionalKey(Schema.String),
  include: Schema.optionalKey(Schema.Array(Schema.String)),
  exclude: Schema.optionalKey(Schema.Array(Schema.String)),
  defaultVisibility: Schema.optionalKey(Level),
  frontmatter: Schema.optionalKey(
    Schema.Struct({
      visibility: Schema.optionalKey(Schema.NonEmptyString),
      summary: Schema.optionalKey(Schema.NonEmptyString),
      title: Schema.optionalKey(Schema.NonEmptyString),
      updated: Schema.optionalKey(Schema.NonEmptyString),
      verified: Schema.optionalKey(Schema.NonEmptyString),
      status: Schema.optionalKey(Schema.NonEmptyString),
      keep: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
  markers: Schema.optionalKey(Schema.Literals(['keep', 'strip'])),
  searchIndex: Schema.optionalKey(Schema.Boolean),
  instructions: Schema.optionalKey(Schema.Record(Level, Schema.NonEmptyString)),
  review: Schema.optionalKey(
    Schema.Struct({
      intervals: Schema.Record(
        Schema.String,
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 36_500 })),
      ),
    }),
  ),
  proposals: Schema.optionalKey(
    Schema.Struct({
      notes: Schema.optionalKey(
        Schema.String.check(
          Schema.makeFilter(isRelativeFolderPath, {
            expected: 'a relative folder path without empty, . or .. segments',
          }),
        ),
      ),
      archivedStatus: Schema.optionalKey(Schema.NonEmptyString),
      obsoleteNotes: Schema.optionalKey(Schema.Literals(['delete', 'archive'])),
    }),
  ),
});
const formatIssue = SchemaIssue.makeFormatterDefault();

/**
 * Validates a configuration and applies its defaults.
 */
export const resolveConfig = (config: unknown): Effect.Effect<ResolvedConfig, InvalidConfigError> =>
  Effect.gen(function* () {
    const data = yield* Schema.decodeUnknownEffect(ConfigData)(config).pipe(
      Effect.mapError((error) => new InvalidConfigError({ reason: formatIssue(error.issue) })),
    );
    const { filter, url } = yield* readHooks(config);
    const levels = data.levels;
    if (new Set(levels).size !== levels.length) {
      return yield* new InvalidConfigError({ reason: 'levels must be unique' });
    }
    const highest = levels[levels.length - 1] ?? levels[0];
    const defaultVisibility = data.defaultVisibility ?? highest;
    const unknownLevels = [defaultVisibility, ...Object.keys(data.instructions ?? {})].filter(
      (level) => !levels.includes(level),
    );
    if (unknownLevels.length > 0) {
      return yield* new InvalidConfigError({
        reason: `unknown levels: ${unknownLevels.join(', ')}`,
      });
    }

    return {
      levels,
      root: data.root ?? '.',
      include: data.include ?? ['**/*.md'],
      exclude: data.exclude ?? [],
      defaultVisibility,
      frontmatterKeys: {
        visibility: data.frontmatter?.visibility ?? 'visibility',
        summary: data.frontmatter?.summary ?? 'summary',
        title: data.frontmatter?.title ?? 'title',
        updated: data.frontmatter?.updated ?? 'updated',
        verified: data.frontmatter?.verified ?? 'verified',
        status: data.frontmatter?.status ?? 'status',
      },
      keep: data.frontmatter?.keep ?? [],
      markers: data.markers ?? 'keep',
      searchIndex: data.searchIndex ?? true,
      instructions: new Map(Object.entries(data.instructions ?? {})),
      filter,
      url,
      reviewIntervals: new Map(Object.entries(data.review?.intervals ?? {})),
      proposals: {
        notesFolder: data.proposals?.notes ?? 'inbox',
        archivedStatus: data.proposals?.archivedStatus ?? 'archived',
        obsoleteNotes: data.proposals?.obsoleteNotes ?? 'delete',
      },
    };
  });

const readHooks = (
  config: unknown,
): Effect.Effect<Pick<ResolvedConfig, 'filter' | 'url'>, InvalidConfigError> => {
  const filter = readProperty(config, 'filter');
  const url = readProperty(config, 'url');
  if (!isOptionalFunction(filter) || !isOptionalFunction(url)) {
    return Effect.fail(new InvalidConfigError({ reason: 'filter and url must be functions' }));
  }
  return Effect.succeed({
    filter: (file) => filter === undefined || filter(file) === true,
    url: (file) => {
      const value = url?.(file);
      return typeof value === 'string' ? value : undefined;
    },
  });
};

const readProperty = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

const isOptionalFunction = (
  value: unknown,
): value is ((...args: readonly unknown[]) => unknown) | undefined =>
  value === undefined || typeof value === 'function';
