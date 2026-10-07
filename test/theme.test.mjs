import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createState, handleRequest } from "../server/http-app.mjs";
import { isThemeMode } from "../server/config-store.mjs";

test("accepts only the supported theme modes", () => {
    assert.equal(isThemeMode("auto"), true);
    assert.equal(isThemeMode("light"), true);
    assert.equal(isThemeMode("dark"), true);
    assert.equal(isThemeMode("system"), false);
    assert.equal(isThemeMode(null), false);
});

test("theme endpoint rejects unsupported values", async (t) => {
    const server = createServer((req, res) => handleRequest(createState(), req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/theme`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: "system" }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Theme must be 'auto', 'light', or 'dark'." });
});
