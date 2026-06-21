import { describe, expect, it } from "vitest";

import type { Role } from "../../shared";

import { buildPrompt } from "./index";
import { fakeVi } from "./testFixtures";
import { worldModel } from "./worldModel";

function inGameReq(vi = fakeVi()) {
  return {
    gameId: "g-1",
    taskType: "speech" as const,
    playerId: "ai-1",
    visibleInformation: vi,
  };
}

describe("L2 世界模型 worldModel()", () => {
  it("含判读核心：对跳 / 票数本身不是证据 / 话少不可疑", () => {
    const text = worldModel();
    expect(text).toContain("对跳");
    expect(text).toContain("票数本身不是证据");
    expect(text).toContain("话少");
  });

  it("含无警长禁令（逐字保留）", () => {
    expect(worldModel()).toContain("没有「警长 / 警徽」这一设定");
  });

  it("不出现身份断言子串", () => {
    expect(worldModel()).not.toMatch(/狼人是|预言家是/);
  });

  it("对所有 role / faction 都装配进 system（全员同一份）", () => {
    const marker = "在动手之前，先把这局狼人杀的底层逻辑想明白";
    const roles: Array<{ role: Role; faction: "good_team" | "werewolf_team" }> = [
      { role: "werewolf", faction: "werewolf_team" },
      { role: "seer", faction: "good_team" },
      { role: "witch", faction: "good_team" },
      { role: "villager", faction: "good_team" },
    ];
    for (const { role, faction } of roles) {
      const prompt = buildPrompt(
        inGameReq(fakeVi({ ownRole: role, ownFaction: faction })),
      );
      expect(prompt.system).toContain(marker);
      // ISO 回归：各 role 都不得出现身份断言。
      expect(prompt.system).not.toMatch(/狼人是|预言家是/);
    }
  });
});
