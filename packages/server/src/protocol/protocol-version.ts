import { Effect, Schema, SchemaIssue } from 'effect';

import { BundleSet } from './bundle-set.ts';
import { Bundle } from './bundle.ts';

/**
 * Version of the bundle format this code reads and writes.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Error for input written in a protocol version this code doesn't support.
 */
export class UnsupportedProtocolError extends Schema.TaggedError<
  UnsupportedProtocolError,
  { readonly brand: unique symbol }
>()('UnsupportedProtocolError', { version: Schema.Unknown }) {
  override get message(): string {
    return `unsupported protocol version ${String(this.version)}; expected ${PROTOCOL_VERSION}`;
  }
}

/**
 * Error for input that doesn't match the protocol's schema.
 */
export class InvalidBundleError extends Schema.TaggedError<
  InvalidBundleError,
  { readonly brand: unique symbol }
>()('InvalidBundleError', { issues: Schema.String }) {
  override get message(): string {
    return `invalid bundle: ${this.issues}`;
  }
}

const ProtocolHeader = Schema.Struct({ protocol: Schema.Unknown });
const formatIssue = SchemaIssue.makeFormatterDefault();

/**
 * Decodes a bundle from untrusted JSON, dropping fields this version doesn't know.
 */
export const decodeBundle = (
  input: unknown,
): Effect.Effect<Bundle, UnsupportedProtocolError | InvalidBundleError> =>
  decodeVersioned(Bundle, input);

/**
 * Decodes a bundle set from untrusted JSON, dropping fields this version doesn't know.
 */
export const decodeBundleSet = (
  input: unknown,
): Effect.Effect<BundleSet, UnsupportedProtocolError | InvalidBundleError> =>
  decodeVersioned(BundleSet, input);

const decodeVersioned = <S extends Schema.Decoder<unknown>>(
  schema: S,
  input: unknown,
): Effect.Effect<S['Type'], UnsupportedProtocolError | InvalidBundleError> =>
  Effect.gen(function* () {
    const header = yield* Schema.decodeUnknownEffect(ProtocolHeader)(input).pipe(
      Effect.mapError((error) => new InvalidBundleError({ issues: formatIssue(error.issue) })),
    );
    if (header.protocol !== PROTOCOL_VERSION) {
      return yield* new UnsupportedProtocolError({ version: header.protocol });
    }
    return yield* Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError((error) => new InvalidBundleError({ issues: formatIssue(error.issue) })),
    );
  });
