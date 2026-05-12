export function createLimiter(maxConcurrent: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (maxConcurrent < 1) throw new Error("maxConcurrent must be >= 1");
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= maxConcurrent) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job();
  };

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        fn()
          .then((v) => {
            active -= 1;
            resolve(v);
            next();
          })
          .catch((err: unknown) => {
            active -= 1;
            reject(err);
            next();
          });
      };
      queue.push(start);
      next();
    });
  };
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
