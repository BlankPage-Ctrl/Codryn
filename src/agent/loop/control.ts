import { stepCountIs, type StopCondition } from 'ai';

export { stepCountIs as maxSteps };

type AnyStopCondition = StopCondition<never, never>;

export function orStop(...conditions: AnyStopCondition[]): AnyStopCondition {
  return async (options) => {
    for (const condition of conditions) {
      if (await condition(options)) return true;
    }
    return false;
  };
}
