import assert from "node:assert/strict";
import test from "node:test";

import { ensurePriceAlertStorage } from "../app/lib/priceAlertStorage.ts";

test("initializes price alert storage before first use", async () => {
  const prepared = [];
  const database = {
    prepare(statement) {
      prepared.push(statement);
      return { statement };
    },
    async batch(statements) {
      assert.equal(statements.length, 3);
      return statements.map(() => ({ success: true }));
    },
  };

  await ensurePriceAlertStorage(database);
  assert.match(prepared[0], /CREATE TABLE IF NOT EXISTS price_alerts/);
  assert.match(prepared[1], /price_alerts_user_idx/);
  assert.match(prepared[2], /price_alerts_active_idx/);
});
