import type { Candidate } from "../routing.js";
import type { ApiProvider, TaskCategory } from "./types.js";

export function slotInsert(
  cliCandidates: Candidate[],
  apiProviders: ApiProvider[],
  taskCategory: TaskCategory
): Candidate[] {
  const merged = [...cliCandidates];
  const enabled = apiProviders
    .map((apiProvider, order) => ({
      apiProvider,
      order,
      slot: apiProvider.routing[taskCategory],
    }))
    .filter(({ slot }) => Number.isInteger(slot) && slot >= 1)
    .sort((a, b) => a.slot - b.slot || a.order - b.order);

  enabled.forEach(({ apiProvider, slot }, inserted) => {
    merged.splice(Math.min(slot - 1 + inserted, merged.length), 0, {
      provider: "api",
      model: apiProvider.model,
      effort: "medium",
      apiProvider,
    });
  });

  return merged;
}
