import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("P9-S01 engineering shell", () => {
  it("renders the minimal runnable app shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "小狼杀" })).toBeInTheDocument();
    expect(screen.getByText("工程可运行壳已就绪")).toBeInTheDocument();
  });
});
