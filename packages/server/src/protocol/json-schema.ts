import { JsonSchema, Schema } from 'effect';

import { BundleSet } from './bundle-set.ts';
import { Bundle } from './bundle.ts';

/**
 * Builds the standalone JSON Schema of a bundle.
 *
 * Uniqueness and build consistency aren't expressible in JSON Schema; only the decoder checks them.
 */
export const buildBundleJsonSchema = (): JsonSchema.JsonSchema => buildStandaloneJsonSchema(Bundle);

/**
 * Builds the standalone JSON Schema of a bundle set.
 *
 * Uniqueness and build consistency aren't expressible in JSON Schema; only the decoder checks them.
 */
export const buildBundleSetJsonSchema = (): JsonSchema.JsonSchema =>
  buildStandaloneJsonSchema(BundleSet);

const buildStandaloneJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema);
  return {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    ...document.schema,
    $defs: document.definitions,
  };
};
