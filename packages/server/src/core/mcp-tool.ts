import type { CallToolResult } from '@modelcontextprotocol/server';
import { Schema } from 'effect';

/**
 * Converts an Effect schema into a tool input schema for the MCP SDK.
 */
export const toToolSchema = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));

/**
 * Returns a tool result holding one text.
 */
export const textResult = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
});

/**
 * Returns a tool result that reports a failure the agent can act on.
 */
export const errorResult = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});
