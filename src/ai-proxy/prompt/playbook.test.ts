import { describe, expect, it } from "vitest";

import { buildPrompt } from "./index";
import { factionPlaybook, goodPlaybook, werewolfPlaybook } from "./playbook";
import { fakeVi } from "./testFixtures";

function speechReq(vi = fakeVi()) {
  return {
    gameId: "g-1",
    taskType: "speech" as const,
    playerId: "ai-1",
    visibleInformation: vi,
  };
}

describe("L3 阵营打法 playbook()", () => {
  it("好人段：采信无对跳单跳查杀 + 保护真预言家（锁首夜冤神 bug）", () => {
    const text = goodPlaybook();
    expect(text).toContain("保护真预言家");
    expect(text).toContain("采信");
    expect(text).toContain("替狼杀");
  });

  it("狼人段：护队友 + 悍跳，并带出队友名单", () => {
    const vi = fakeVi({
      ownRole: "werewolf",
      ownFaction: "werewolf_team",
      teammates: [
        { playerId: "ai-9", name: "胖虎", seat: 5, role: "werewolf", alive: true },
      ],
    });
    const text = werewolfPlaybook(vi);
    expect(text).toContain("悍跳");
    expect(text).toContain("帮队友洗清");
    expect(text).toContain("胖虎");
  });

  it("factionPlaybook 按阵营条件装配", () => {
    expect(factionPlaybook(fakeVi({ ownFaction: "good_team" }))).toContain(
      "保护真预言家",
    );
    expect(
      factionPlaybook(fakeVi({ ownFaction: "werewolf_team", ownRole: "werewolf" })),
    ).toContain("悍跳");
  });

  it("好人 system 不含狼专属词；狼 system 不含好人专属词（条件装配）", () => {
    const good = buildPrompt(
      speechReq(fakeVi({ ownRole: "villager", ownFaction: "good_team" })),
    ).system;
    const wolf = buildPrompt(
      speechReq(fakeVi({ ownRole: "werewolf", ownFaction: "werewolf_team" })),
    ).system;
    expect(good).not.toContain("悍跳");
    expect(wolf).not.toContain("保护真预言家");
  });
});
