import { AsyncLocalStorage } from "node:async_hooks";

/** Caller identity for the control request currently creating sessions. */
export const externalClientContext = new AsyncLocalStorage<string>();
