/**
 * Normalizes one-or-many input values into a new array.
 */
export function toArray<T>(input: T | T[]): T[] {
  return Array.isArray(input) ? Array.from(input) : [input]
}
