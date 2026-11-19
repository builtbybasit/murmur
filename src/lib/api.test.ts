// Run: bun src/lib/api.test.ts
import assert from "node:assert/strict";
import { ApiError, MAX_RETRIES, retryDelay, toError, type ProviderError } from "./api";

const err = (code: ProviderError["code"], status = 0, retryAfter: number | null = null) =>
  ({ code, status, message: "", retryAfter }) as ProviderError;

assert.equal(retryDelay(err("rate", 429), 0), 6);
assert.equal(retryDelay(err("rate", 429, 2), 1), 2); // Retry-After wins
assert.equal(retryDelay(err("network"), 2), 16);
assert.equal(retryDelay(err("http", 503), 0), 4);
assert.equal(retryDelay(err("http", 500), MAX_RETRIES), null); // used up
assert.equal(retryDelay(err("http", 404), 0), null);
assert.equal(retryDelay(err("auth", 401), 0), null);

const e = new ApiError(err("auth", 401));
assert.equal(toError(e), e);
assert.deepEqual(toError(new Error("boom")), { ...err("network"), message: "boom" });
console.log("api ok");
