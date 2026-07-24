import test from "node:test";
import assert from "node:assert/strict";

import { waitForTaskOrTimeout } from "../public/js/utils/async.js";

test("optional async work reports completion before its deadline", async () => {
  const result = await waitForTaskOrTimeout(Promise.resolve("done"), 50);
  assert.deepEqual(result, { timedOut: false });
});

test("optional async work releases its waiter at the deadline and may finish later", async () => {
  let finish;
  const task = new Promise((resolve) => {
    finish = resolve;
  });
  const result = await waitForTaskOrTimeout(task, 5);
  assert.deepEqual(result, { timedOut: true });
  finish();
  await task;
});

test("optional async work reports failures that happen before its deadline", async () => {
  const error = new Error("indicator failed");
  const result = await waitForTaskOrTimeout(Promise.reject(error), 50);
  assert.equal(result.timedOut, false);
  assert.equal(result.error, error);
});
