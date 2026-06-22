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
  it("三档路由：发言→speech 档、投票/夜晚→reasoning 档、复盘→review 档", () => {
    const config = loadProxyConfig({
      AI_BASE_URL: "https://llm.example/v1",
      AI_API_KEY: "k",
      AI_SPEECH_MODEL: "gpt-5.4",
      AI_REASONING_MODEL: "gpt-5.5",
      AI_REVIEW_MODEL: "gpt-5.5",
    });
    // 发言类。
    expect(modelForTask("speech", config)).toBe("gpt-5.4");
    expect(modelForTask("tie_speech", config)).toBe("gpt-5.4");
    expect(modelForTask("last_words", config)).toBe("gpt-5.4");
    // 推理类。
    expect(modelForTask("vote", config)).toBe("gpt-5.5");
    expect(modelForTask("night_action", config)).toBe("gpt-5.5");
    expect(modelForTask("witch_action", config)).toBe("gpt-5.5");
    expect(modelForTask("hunter_shoot", config)).toBe("gpt-5.5");
    // 复盘。
    expect(modelForTask("review_question", config)).toBe("gpt-5.5");
  });

  it("旧 AI_MODEL 作为发言/推理兜底（兼容旧 .env）", () => {
    const config = loadProxyConfig({
      AI_BASE_URL: "https://llm.example/v1",
      AI_API_KEY: "k",
      AI_MODEL: "legacy-model",
    });
    expect(modelForTask("speech", config)).toBe("legacy-model");
    expect(modelForTask("vote", config)).toBe("legacy-model");
    // 复盘有独立默认，不被 AI_MODEL 兜底。
    expect(modelForTask("review_question", config)).toBe("gpt-5.5");
  });
});
