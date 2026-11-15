import { Schema } from 'effect';

import { isEachUnique } from './uniqueness.ts';

const PATH_SEGMENT = String.raw`(?:[^/\\.][^/\\]*|\.[^/\\.][^/\\]*|\.\.[^/\\]+)`;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * Name of an access level, e.g. `public`.
 *
 * Lowercase so that it is safe in URLs and as a markup tag name.
 */
export const Level = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u)).annotate({
  identifier: 'Level',
});
export type Level = typeof Level.Type;

/**
 * Relative POSIX path of a file in a bundle, e.g. `projects/example.md`.
 *
 * No leading `/`, no backslashes, and no `.` or `..` segments.
 */
export const FilePath = Schema.String.check(
  Schema.isPattern(new RegExp(`^${PATH_SEGMENT}(?:/${PATH_SEGMENT})*$`, 'u')),
).annotate({ identifier: 'FilePath' });
export type FilePath = typeof FilePath.Type;

/**
 * Relative POSIX path of a folder in a bundle, where `''` is the root.
 */
export const FolderPath = Schema.String.check(
  Schema.isPattern(new RegExp(`^(?:${PATH_SEGMENT}(?:/${PATH_SEGMENT})*)?$`, 'u')),
).annotate({ identifier: 'FolderPath' });
export type FolderPath = typeof FolderPath.Type;

/**
 * Identification of the build that produced a bundle.
 */
export const BuildInfo = Schema.Struct({
  id: Schema.NonEmptyString,
  createdAt: Schema.String.check(Schema.isPattern(TIMESTAMP)),
  source: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: 'BuildInfo' });
export type BuildInfo = typeof BuildInfo.Type;

/**
 * Metadata of a folder, used when listing its parent.
 */
export const BundleFolder = Schema.Struct({
  path: FolderPath,
  summary: Schema.optionalKey(Schema.String),
}).annotate({ identifier: 'BundleFolder' });
export type BundleFolder = typeof BundleFolder.Type;

/**
 * File in a bundle, with content already redacted for the bundle's level.
 */
export const BundleFile = Schema.Struct({
  path: FilePath,
  visibility: Schema.optionalKey(Level),
  title: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  updated: Schema.optionalKey(Schema.String.check(Schema.isPattern(CALENDAR_DATE))),
  verified: Schema.optionalKey(Schema.String.check(Schema.isPattern(CALENDAR_DATE))),
  reviewDue: Schema.optionalKey(Schema.String.check(Schema.isPattern(CALENDAR_DATE))),
  url: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9+.-]*:/u))),
  meta: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  content: Schema.String,
}).annotate({ identifier: 'BundleFile' });
export type BundleFile = typeof BundleFile.Type;

/**
 * Search index built ahead of time from a bundle's own files.
 *
 * `format` names the engine and its options; a reader that doesn't know the format builds its own index instead.
 */
export const BundleSearchIndex = Schema.Struct({
  format: Schema.NonEmptyString,
  data: Schema.Unknown,
}).annotate({ identifier: 'BundleSearchIndex' });
export type BundleSearchIndex = typeof BundleSearchIndex.Type;

/**
 * Everything one level may see from one build.
 */
export const Bundle = Schema.Struct({
  protocol: Schema.Literal(1),
  level: Level,
  highest: Schema.optionalKey(Schema.Boolean),
  build: BuildInfo,
  instructions: Schema.optionalKey(Schema.String),
  search: Schema.optionalKey(BundleSearchIndex),
  folders: Schema.Array(BundleFolder).check(
    Schema.makeFilter((folders) => isEachUnique(folders.map((folder) => folder.path)), {
      expected: 'folders with unique paths',
    }),
  ),
  files: Schema.Array(BundleFile).check(
    Schema.makeFilter((files) => isEachUnique(files.map((file) => file.path)), {
      expected: 'files with unique paths',
    }),
  ),
}).annotate({ identifier: 'Bundle' });
export type Bundle = typeof Bundle.Type;
