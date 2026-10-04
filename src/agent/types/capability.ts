export interface ModelCapability {
  reasoning: boolean;
  thinkingFormat: string | null;
  thinkingCanDisable: boolean;
  thinkingRange: string[] | null;
}

export interface CapabilityProvider {
  id: string;
  baseURL?: string;
  apiKey?: string;
}
