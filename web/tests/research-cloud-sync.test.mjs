import assert from "node:assert/strict";
import test from "node:test";
import { createAccountStorageClient } from "../app/lib/accountStorage.ts";

const key = "ticklens.annotations.v1";

test("a second device honors database deletion and cannot revive annotations from shared browser state", async () => {
  const writes = [];
  const client = createAccountStorageClient(async (_url, init) => {
    if (init?.method === "PUT") {
      const entry = JSON.parse(init.body);
      writes.push(entry);
      return Response.json({ userId: "alice", entry: { ...entry, revision: entry.revision + 1 } });
    }
    return Response.json({ userId: "alice", entries: [{ key, value: "[]", revision: 5, mutationId: "previous-deletion" }] });
  });
  await client.hydrate("alice");
  assert.equal(client.storage.getItem(key), "[]");
  client.storage.setItem(key, "[]");
  await client.flush();
  assert.deepEqual(writes, []);
  client.storage.setItem(key, JSON.stringify([{ id: "new", text: "新标注" }]));
  await client.flush();
  assert.equal(writes[0].revision, 5);
  assert.equal(writes[0].userId, "alice");
});

test("an outstanding response for one account cannot hydrate another account", async () => {
  let finish;
  const client = createAccountStorageClient(async (url) => {
    if (url.includes("alice")) return new Promise((resolve) => { finish = resolve; });
    return Response.json({ userId: "bob", entries: [] });
  });
  const alice = client.hydrate("alice");
  await client.hydrate("bob");
  finish(Response.json({ userId: "alice", entries: [{ key, value: "private-alice", revision: 1, mutationId: "original" }] }));
  await alice;
  assert.equal(client.getStatus().userId, "bob");
  assert.equal(client.storage.getItem(key), null);
});

test("conflicting cloud edits remain pending instead of silently overwriting newer records", async () => {
  const client = createAccountStorageClient(async (_url, init) => init?.method === "PUT"
    ? Response.json({ error: "数据冲突" }, { status: 409 })
    : Response.json({ userId: "alice", entries: [] }));
  await client.hydrate("alice");
  client.storage.setItem(key, "my draft");
  await assert.rejects(client.flush(), /数据冲突/);
  assert.equal(client.storage.getItem(key), "my draft");
  assert.equal(client.getStatus().phase, "error");
  assert.equal(client.getStatus().pending, 1);
  assert.match(client.exportPending(), /my draft/);
});
