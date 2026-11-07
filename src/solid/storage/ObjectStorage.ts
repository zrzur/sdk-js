import type { SetStoreFunction } from "solid-js/store";
import { createStore } from "solid-js/store";

import {
  type HydrationInput,
  type Hydrators,
  hydrate,
} from "../hydration/index.js";

/**
 * Wrapper around Solid.js store
 */
export class ObjectStorage<T> {
  private store: Record<string, T>;
  readonly set: SetStoreFunction<Record<string, T>>;

  /**
   * Create new object storage
   */
  constructor() {
    const [store, setStore] = createStore<Record<string, T>>({});
    // the store proxy itself is kept; reads happen in tracked scopes
    // eslint-disable-next-line solid/reactivity
    this.store = store;
    this.set = setStore;
    this.get = this.get.bind(this);
  }

  /**
   * Get object by ID
   * @param id ID
   * @returns Object
   */
  get(id: string): T | undefined {
    return this.store[id];
  }

  /**
   * Hydrate some data into storage
   * @param id ID
   * @param type Hydration type
   * @param context Context
   * @param data Input Data
   */
  hydrate(
    id: string,
    type: keyof Hydrators,
    context: unknown,
    data?: unknown,
  ): void {
    if (data) {
      const input = { partial: false, ...data } as HydrationInput;
      this.set(id, hydrate(type, input, context, true) as T);
    }
  }

  /**
   * Hydrate some data without putting it into storage. Call {@link add}
   * afterwards to add the hydrated value into storage.
   * @param type Hydration type
   * @param context Context
   * @param data Input Data
   * @returns The hydrated type
   */
  hydrateOnly(type: keyof Hydrators, context: unknown, data: object): T {
    const input = { partial: false, ...data } as HydrationInput;
    return hydrate(type, input, context, true) as T;
  }

  /**
   * Add a previously hydrated object to the storage
   * @param id ID
   * @param toAdd Hydrated object
   */
  add(id: string, toAdd: T) {
    this.set(id, toAdd);
  }
}
