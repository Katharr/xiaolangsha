import type { Ruleset } from "./types";

export const QUICK_6_V1_RULESET: Ruleset = {
  id: "quick-6-v1",
  name: "quick-6-v1",
  playerCount: 6,
  roles: ["werewolf", "werewolf", "seer", "witch", "villager", "villager"],
  defaultWinConditionMode: "side_elimination",
  supportedWinConditionModes: ["side_elimination", "total_elimination"]
};

export function getRuleset(rulesetId: Ruleset["id"]): Ruleset {
  if (rulesetId !== QUICK_6_V1_RULESET.id) {
    throw new Error(`Unknown ruleset: ${rulesetId}`);
  }

  return QUICK_6_V1_RULESET;
}
