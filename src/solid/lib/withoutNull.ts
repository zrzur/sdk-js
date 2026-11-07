/**
 * An API type as the app reads it: fields the server sends as `null` are
 * left out (read as `undefined`), in nested objects and lists too. Optional
 * fields stay optional.
 */
export type WithoutNull<T> = T extends readonly (infer Item)[]
  ? WithoutNull<Item>[]
  : T extends object
    ? {
        [K in keyof T]: null extends T[K]
          ? WithoutNull<Exclude<T[K], null>> | undefined
          : WithoutNull<T[K]>;
      }
    : T;

/**
 * Leave out the `null` fields of API data (JSON only: objects, lists, values)
 * @param value API data
 * @returns The same data without `null` fields
 */
export function withoutNull<T>(value: T): WithoutNull<T> {
  if (Array.isArray(value)) {
    return value.map((item) => withoutNull(item)) as WithoutNull<T>;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, field]) => field !== null)
        .map(([key, field]) => [key, withoutNull(field)]),
    ) as WithoutNull<T>;
  }
  return value as WithoutNull<T>;
}
