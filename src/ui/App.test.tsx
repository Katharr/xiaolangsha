import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the project foundation shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "小狼杀", level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText("训练桌占位")).toBeInTheDocument();
    expect(screen.getByText("项目基础搭建")).toBeInTheDocument();
  });
});
