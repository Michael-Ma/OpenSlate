/** Discovery boundary only; job submission and adapters are not implemented. */
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
