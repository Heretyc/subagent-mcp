export type ApiEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export function effortToTemperature(effort?: ApiEffort): number {
  switch (effort) {
    case "none":
    case "low":
      return 0.8;
    case "high":
      return 0.3;
    case "xhigh":
      return 0.2;
    case "max":
      return 0.1;
    case "medium":
    default:
      return 0.5;
  }
}
