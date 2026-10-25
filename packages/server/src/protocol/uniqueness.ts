/**
 * Returns whether no value occurs twice.
 */
export function isEachUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
