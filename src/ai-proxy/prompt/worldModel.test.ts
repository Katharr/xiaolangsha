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

  it("含无警长禁令", () => {
    expect(worldModel()).toContain("没有警长 / 警徽");
  });

  it("硬信息源拓宽到猎人/女巫，别冤推给信息的好人（治集体冤好人）", () => {
    const text = worldModel();
    expect(text).toContain("猎人");
    expect(text).toContain("给信息的好人");
  });

  it("含平安夜公共认知：无守卫局平安夜=女巫救人、解药已耗", () => {
    const text = worldModel();
    expect(text).toContain("平安夜");
    expect(text).toContain("解药已耗");
  });

  it("不出现身份断言子串", () => {
    expect(worldModel()).not.toMatch(/狼人是|预言家是/);
  });

  it("对所有 role / faction 都装配进 system（全员同一份）", () => {
    const marker = "几条对每个人都成立的底线认知";
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
