// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SkillEditor } from "../skill-editor";
import { SKILL_BODY_MAX } from "@/lib/skills-ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// react-markdown is ESM-only and pulls heavy deps; stub it for this test.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: () => null,
}));

describe("SkillEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disables save when name is empty", () => {
    render(<SkillEditor mode="new" />);
    const saveBtn = screen.getByRole("button", { name: "保存" });
    expect(saveBtn).toBeDisabled();
  });

  it("enables save once name and body are filled", () => {
    render(
      <SkillEditor
        mode="new"
        initial={{ name: "test", bodyMd: "hello" }}
      />
    );
    const saveBtn = screen.getByRole("button", { name: "保存" });
    expect(saveBtn).not.toBeDisabled();
  });

  it("renders character counter and updates when body changes", () => {
    render(<SkillEditor mode="new" initial={{ name: "x", bodyMd: "hi" }} />);
    expect(screen.getByText(`2 / ${SKILL_BODY_MAX}`)).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("# 技能说明...");
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(screen.getByText(`5 / ${SKILL_BODY_MAX}`)).toBeInTheDocument();
  });

  it("disables save when body exceeds SKILL_BODY_MAX", () => {
    const overLimit = "x".repeat(SKILL_BODY_MAX + 1);
    render(
      <SkillEditor mode="new" initial={{ name: "test", bodyMd: overLimit }} />
    );
    const saveBtn = screen.getByRole("button", { name: "保存" });
    expect(saveBtn).toBeDisabled();
  });

  it("shows association warning in edit mode when count >= 1", () => {
    render(
      <SkillEditor
        mode="edit"
        initial={{ id: "s1", name: "test", bodyMd: "hi" }}
        associationCount={2}
        associatedStrategyNames={["A", "B"]}
      />
    );
    expect(
      screen.getByText(/该技能当前被 2 个策略关联/)
    ).toBeInTheDocument();
    expect(screen.getByText(/关联策略：A、B/)).toBeInTheDocument();
  });

  it("does not show association warning when count is 0", () => {
    render(
      <SkillEditor
        mode="edit"
        initial={{ id: "s1", name: "test", bodyMd: "hi" }}
        associationCount={0}
      />
    );
    expect(screen.queryByText(/该技能当前被/)).not.toBeInTheDocument();
  });

  it("shows delete confirmation when delete button is clicked", () => {
    render(
      <SkillEditor
        mode="edit"
        initial={{ id: "s1", name: "MySkill", bodyMd: "hi" }}
        associationCount={3}
      />
    );
    const deleteBtn = screen.getByRole("button", { name: /删除/ });
    fireEvent.click(deleteBtn);
    expect(screen.getByText(/确认删除「MySkill」？/)).toBeInTheDocument();
    expect(
      screen.getByText(/该技能被 3 个策略关联，关联会自动解除/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认删除" })
    ).toBeInTheDocument();
  });
});
