/**
 * Yields control back to the event loop so the UI thread can repaint
 * (progress bar width, status text) during long synchronous stretches of
 * work. Uses a macrotask (setTimeout) rather than a microtask (Promise
 * resolve/queueMicrotask) because microtasks run before the browser gets a
 * chance to paint — only a macrotask boundary actually lets a pending DOM
 * mutation hit the screen.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Call inside tight loops to yield every `every` iterations without paying
 * the cost of a macrotask hop on every single item (which would noticeably
 * slow large imports). `counter` should be the 1-based count of items
 * processed so far.
 */
export async function maybeYield(counter: number, every = 50): Promise<void> {
  if (counter % every === 0) {
    await yieldToEventLoop();
  }
}
