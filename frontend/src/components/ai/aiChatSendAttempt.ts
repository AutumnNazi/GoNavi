import {
  beginAIChatLocalToolRun,
  shouldStopAIChatLocalToolRun,
} from './aiChatLocalToolLifecycle';

export interface AIChatSendAttempt {
  shouldAbort: () => Promise<boolean>;
  finish: () => void;
}

export interface AIChatSendAttemptCoordinator {
  begin: (sid: string) => AIChatSendAttempt;
  invalidate: () => void;
}

export type AIChatSendAttemptStageResult<TResult> =
  | { aborted: true }
  | { aborted: false; result: TResult };

export const runAIChatSendAttemptStages = async <TSystemContext, TCompression, TResult>({
  attempt,
  buildSystemContext,
  compressContext,
  dispatch,
}: {
  attempt: AIChatSendAttempt;
  buildSystemContext: () => TSystemContext | Promise<TSystemContext>;
  compressContext: () => TCompression | Promise<TCompression>;
  dispatch: (stages: {
    systemContext: TSystemContext;
    compression: TCompression;
  }) => Promise<TResult>;
}): Promise<AIChatSendAttemptStageResult<TResult>> => {
  const systemContext = await buildSystemContext();
  if (await attempt.shouldAbort()) return { aborted: true };

  const compression = await compressContext();
  if (await attempt.shouldAbort()) return { aborted: true };

  return {
    aborted: false,
    result: await dispatch({ systemContext, compression }),
  };
};

export const createAIChatSendAttemptCoordinator = (): AIChatSendAttemptCoordinator => {
  let generation = 0;

  return {
    begin: (sid: string) => {
      generation += 1;
      const attemptGeneration = generation;
      const finishRun = beginAIChatLocalToolRun(sid);
      let finished = false;

      return {
        shouldAbort: async () => {
          if (attemptGeneration !== generation) return true;
          const stopped = await shouldStopAIChatLocalToolRun(sid);
          return stopped || attemptGeneration !== generation;
        },
        finish: () => {
          if (finished) return;
          finished = true;
          finishRun();
        },
      };
    },
    invalidate: () => {
      generation += 1;
    },
  };
};
