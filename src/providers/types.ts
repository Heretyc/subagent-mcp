import { TASK_CATEGORIES } from "../routing.js";

export type TaskCategory = Exclude<(typeof TASK_CATEGORIES)[number], "fallback_default">;

export interface ApiProvider {
  name: string;
  api_style: "claude" | "openai";
  base_url: string;
  model: string;
  key_env: string;
  routing: Record<TaskCategory, number>;
}
