import { describe, expect, it } from "vitest";

import { NAME_PERSONAS, NAME_POOL, personaForName } from "./personas";

describe("personas", () => {
  it("keeps NAME_POOL identical to the historical order (存档复现)", () => {
    // 调整顺序会改变 seededShuffle 的名字分配，破坏已存档对局复现——若需改动请慎重。
    expect(NAME_POOL).toEqual([
      "小林",
      "阿杰",
      "花花",
      "老张",
      "莉莉",
      "大壮",
      "囡囡",
      "阿明",
      "蓉蓉",
      "胖虎",
    ]);
  });

  it("每个名字都有性格，且 NAME_POOL 由其键派生", () => {
    expect(NAME_POOL).toEqual(Object.keys(NAME_PERSONAS));
    for (const name of NAME_POOL) {
      expect(personaForName(name).length).toBeGreaterThan(0);
    }
  });

  it("未知名字回退中性人设，不抛错", () => {
    expect(personaForName("查无此人")).toBe("说话自然、随和，像普通玩家一样聊天");
  });
});
