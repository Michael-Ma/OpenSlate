/** Discovery boundary; standalone cloud transports require application execution integration. */
export interface VideoCapabilities {
  providerId: string;
  modelId: string;
  execution: "cloud" | "local";
  conditioningModes: readonly string[];
  durationSeconds: { min: number; max: number };
  supportsCancellation: boolean;
}

export interface VideoProvider {
  readonly id: string;
  capabilities(): Promise<VideoCapabilities>;
}
export * from "./fake.js";
export * from "./minimax-h3.js";
export * from "./openai-image.js";
