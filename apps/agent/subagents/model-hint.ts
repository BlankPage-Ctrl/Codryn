export interface HintModelRecord {
  id: string;
  modelId: string;
}

export interface HintProviderRecord {
  id: string;
  name: string;
  models: HintModelRecord[];
}

export interface HintMatch {
  providerId: string;
  modelId: string;
}

/**
 * Resolves a user-authored `modelHint` against configured models.
 * Accepts a model id, a record id, or `provider/model`. Returns null when
 * unknown or ambiguous so the caller falls back to the parent model.
 */
export function matchModelHint(providers: HintProviderRecord[], hint: string): HintMatch | null {
  const needle = hint.trim().toLowerCase();
  if (!needle) return null;
  const candidates: HintMatch[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      const modelId = model.modelId.toLowerCase();
      const qualified = `${provider.name.toLowerCase()}/${modelId}`;
      if (modelId === needle || model.id.toLowerCase() === needle || qualified === needle) {
        candidates.push({ providerId: provider.id, modelId: model.modelId });
      }
    }
  }
  if (candidates.length === 1) return candidates[0] ?? null;
  return null;
}
