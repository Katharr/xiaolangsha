import { describe, expect, it } from "vitest";

import { characterForName } from "../../shared";

import { character } from "./character";
import { fakeVi } from "./testFixtures";

describe("L0 人物卡 character()", () => {
  it("含职业字段 + 两行原前缀 + 自我指涉锚（先做人）", () => {
    const text = character(fakeVi({ ownName: "老张", ownSeat: 6 }));
    const card = characterForName("老张");
    expect(text).toContain(card.profession);
    // 保留两行原前缀（与 handler.test 的断言一致）。
    expect(text).toContain("你的性格：");
    expect(text).toContain("你判断局面的倾向：");
    // 钉「你就是 N 号本人」修自我指涉 bug。
    expect(text).toContain("6号");
    expect(text).toContain("本人");
  });

  it("异名人物卡不同、同名稳定", () => {
    const zhang = character(fakeVi({ ownName: "老张" }));
    const hu = character(fakeVi({ ownName: "胖虎" }));
    expect(zhang).not.toBe(hu);
    expect(character(fakeVi({ ownName: "老张" }))).toBe(zhang);
  });

  it("好人不渲染狼专属伪装风格（wolfDeception 只在狼身份出现）", () => {
    const card = characterForName("小林");
    const good = character(fakeVi({ ownName: "小林", ownFaction: "good_team" }));
    const wolf = character(fakeVi({ ownName: "小林", ownFaction: "werewolf_team" }));
    expect(good).not.toContain(card.wolfDeception);
    expect(wolf).toContain(card.wolfDeception);
  });

  it("不泄漏真相：人物卡不含身份/阵营断言子串", () => {
    const text = character(fakeVi({ ownName: "蓉蓉", ownFaction: "good_team" }));
    expect(text).not.toMatch(/狼人是|预言家是/);
  });

  it("未知名字回退中性卡、不抛错", () => {
    expect(() => character(fakeVi({ ownName: "查无此人" }))).not.toThrow();
    expect(character(fakeVi({ ownName: "查无此人" }))).toContain("你的性格：");
  });
});
