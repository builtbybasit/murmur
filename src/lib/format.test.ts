import { strict as assert } from "node:assert";
import { bytes, clock, minutes, plural, thousands } from "./format";

assert.equal(plural(1, "segment"), "1 segment");
assert.equal(plural(1204, "segment"), "1,204 segments");
assert.equal(clock(83.4), "1:23");
assert.equal(clock(0), "0:00");
assert.equal(bytes(500), "500 B");
assert.equal(bytes(1536), "1.5 KB");
assert.equal(bytes(5 * 1024 ** 3), "5.0 GB");
assert.equal(thousands(999), "999");
assert.equal(thousands(12345), "12.3k");
assert.equal(minutes(10, 1), 1);
assert.equal(minutes(600, 2), 5);
console.log("format ok");
