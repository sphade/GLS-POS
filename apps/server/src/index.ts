import { createApp } from "./app.js";

/**
 * Worker entry point. Exports the fetch handler (the Hono app) plus the
 * Durable Object class so the runtime can instantiate per-store objects.
 */
export { StoreDurableObject } from "./durable-objects/store.do.js";

const app = createApp();

export default app;
