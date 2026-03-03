type PromiseAnyFunction = <T>(
  values: Iterable<PromiseLike<T> | T>,
) => Promise<T>;

export const promiseAny: PromiseAnyFunction = (
  Promise as PromiseConstructor & { any?: PromiseAnyFunction }
).any
  ? (
      Promise as PromiseConstructor & { any: PromiseAnyFunction }
    ).any.bind(Promise)
  : async <T>(values: Iterable<PromiseLike<T> | T>): Promise<T> => {
      return await new Promise<T>((resolve, reject) => {
        let pending: number = 0;
        let settled: boolean = false;
        const errors: unknown[] = [];

        for (const value of values) {
          pending += 1;
          Promise.resolve(value).then(
            (result: T): void => {
              if (settled) {
                return;
              }
              settled = true;
              resolve(result);
            },
            (error: unknown): void => {
              errors.push(error);
              pending -= 1;
              if (!settled && pending === 0) {
                reject(errors);
              }
            },
          );
        }

        if (pending === 0) {
          reject([]);
        }
      });
    };

export class RelayMissError extends Error {
  constructor() {
    super('Relay query returned no result');
    this.name = 'RelayMissError';
  }
}
