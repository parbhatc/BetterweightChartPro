/**
 * Stop awaiting optional work after a bounded delay while leaving the task
 * alive to finish in the background. Fulfillment and rejection handlers stay
 * attached after timeout, so an abandoned task cannot become an unhandled
 * rejection.
 *
 * @param {Promise<unknown>} task
 * @param {number} timeoutMs
 * @returns {Promise<{ timedOut: boolean, error?: unknown }>}
 */
export function waitForTaskOrTimeout(task, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ timedOut: true }), Math.max(0, timeoutMs));
    Promise.resolve(task).then(
      () => finish({ timedOut: false }),
      (error) => finish({ timedOut: false, error }),
    );
  });
}
