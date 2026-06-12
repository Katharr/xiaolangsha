import { expect, test } from "@playwright/test";

test("shows the project foundation training shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "小狼杀" })).toBeVisible();
  await expect(page.getByLabel("训练桌占位")).toBeVisible();
  await expect(page.getByText("行动面板")).toBeVisible();
  await expect(page.getByText("无 API key 可运行")).toBeVisible();
});
