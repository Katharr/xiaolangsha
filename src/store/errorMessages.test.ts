import { describe, expect, it } from "vitest";

import { appErrorCodes, type AppError, type AppErrorCode } from "../shared";

import { toUserMessage } from "./errorMessages";

const makeError = (over: Partial<AppError> & { code: AppErrorCode }): AppError => ({
  message: "技术日志串（不应展示）",
  retryable: false,
  source: "rules",
  ...over,
});

const hasChinese = (text: string) => /[一-鿿]/.test(text);

describe("toUserMessage", () => {
  it("每个错误码都返回非空中文，且绝不透出技术日志串", () => {
    const technical = "技术日志串（不应展示）";
    for (const code of appErrorCodes) {
      const text = toUserMessage(makeError({ code, message: technical }));
      expect(text.trim().length).toBeGreaterThan(0);
      expect(hasChinese(text)).toBe(true);
      expect(text).not.toContain(technical);
    }
  });

  it("优先使用 error.userMessage（如 store 自填的中文）", () => {
    const text = toUserMessage(
      makeError({
        code: "ACTION_NOT_ALLOWED",
        userMessage: "复盘追问仅在复盘阶段可用。",
      }),
    );
    expect(text).toBe("复盘追问仅在复盘阶段可用。");
  });

  it("空白 userMessage 不算数，回退到 code 兜底", () => {
    const text = toUserMessage(
      makeError({ code: "ACTION_NOT_ALLOWED", userMessage: "   " }),
    );
    expect(text).toBe("当前阶段不能执行该操作。");
  });

  it("命中规则 message 时给出更精准的细分文案", () => {
    expect(
      toUserMessage(
        makeError({ code: "ACTION_NOT_ALLOWED", message: "Self vote is not allowed." }),
      ),
    ).toContain("不能投自己");

    expect(
      toUserMessage(
        makeError({ code: "ACTION_NOT_ALLOWED", message: "Vote target is not legal." }),
      ),
    ).toContain("不可选");

    expect(
      toUserMessage(
        makeError({ code: "INVALID_ACTION", message: "Speech text is invalid." }),
      ),
    ).toContain("500");
  });

  it("AI 类错误文案点明已降级到本地兜底", () => {
    for (const code of ["AI_TIMEOUT", "AI_JSON_INVALID", "AI_UNAVAILABLE"] as const) {
      expect(toUserMessage(makeError({ code }))).toContain("兜底");
    }
  });

  it("未识别的 message 不会被透出，回退到 code 兜底", () => {
    const text = toUserMessage(
      makeError({ code: "INVALID_ACTION", message: "Some unknown English string." }),
    );
    expect(text).toBe("操作无效，请重试。");
  });
});
