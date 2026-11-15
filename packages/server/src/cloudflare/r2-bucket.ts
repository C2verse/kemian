/**
 * Subset of a Cloudflare R2 bucket binding that the bundle and proposal stores use.
 */
export interface R2BucketLike {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
  list(options: { readonly prefix: string; readonly cursor?: string }): Promise<{
    readonly objects: readonly { readonly key: string }[];
    readonly truncated: boolean;
    readonly cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<void>;
}
