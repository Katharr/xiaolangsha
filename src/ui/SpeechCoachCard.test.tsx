import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpeechCoachCard } from "./SpeechCoachCard";

describe("SpeechCoachCard", () => {
  it("renders role-specific tips (seer 必跳 / witch 藏 / werewolf 装好人)", () => {
    const { rerender } = render(<SpeechCoachCard role="seer" day={1} />);
    expect(screen.getByText(/第一天要跳出来/)).toBeInTheDocument();

    rerender(<SpeechCoachCard role="witch" day={1} />);
    expect(screen.getByText(/要藏：当自己是村民正常发言/)).toBeInTheDocument();

    rerender(<SpeechCoachCard role="werewolf" day={1} />);
    expect(screen.getByText(/要装好人/)).toBeInTheDocument();

    // 通用三段式与忌行常驻。
    expect(screen.getByText(/发言三段式/)).toBeInTheDocument();
    expect(screen.getByText(/没理由地跟票/)).toBeInTheDocument();
  });

  it("defaults open on day 1 and can be collapsed", () => {
    render(<SpeechCoachCard role="villager" day={1} />);
    const toggle = screen.getByRole("button", { name: /新手提示/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/发言三段式/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/发言三段式/)).not.toBeInTheDocument();
  });

  it("defaults collapsed after day 1 and can be expanded", () => {
    render(<SpeechCoachCard role="villager" day={2} />);
    const toggle = screen.getByRole("button", { name: /新手提示/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/发言三段式/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText(/发言三段式/)).toBeInTheDocument();
  });
});
