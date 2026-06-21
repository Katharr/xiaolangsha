import { describe, expect, it } from "vitest";

import { loadProxyConfig, modelForTask, temperatureForTask } from "./config";

describe("temperatureForTask", () => {
  it("发言类走高温、行动/投票类走低温（发言 > 投票）", () => {
    const speech = temperatureForTask("speech");
    const vote = temperatureForTask("vote");
    expect(speech).toBeGreaterThan(vote);
    // 行动类与投票同档（低温）。
    expect(temperatureForTask("night_action")).toBe(vote);
    expect(temperatureForTask("witch_action")).toBe(vote);
    expect(temperatureForTask("hunter_shoot")).toBe(vote);
    // 发言、拉票、遗言同档（高温）。
    expect(temperatureForTask("tie_speech")).toBe(speech);
    expect(temperatureForTask("last_words")).toBe(speech);
  });
});

describe("modelForTask", () => {
  it("复盘走 reviewModel，其余走 model", () => {
    const config = loadProxyConfig({
      AI_BASE_URL: "https://llm.example/v1",
      AI_API_KEY: "k",
      AI_MODEL: "gpt-5.4-mini",
      AI_REVIEW_MODEL: "gpt-5.5",
    });
    expect(modelForTask("review_question", config)).toBe("gpt-5.5");
    expect(modelForTask("vote", config)).toBe("gpt-5.4-mini");
    expect(modelForTask("speech", config)).toBe("gpt-5.4-mini");
  });
});
