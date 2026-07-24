import React from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/provider";
import LanguageSettingsPanel from "./LanguageSettingsPanel";

vi.mock("../i18n/runtime", () => ({
  syncLanguageRuntime: vi.fn(async () => undefined),
}));

describe("LanguageSettingsPanel", () => {
  it("renders language options and updates preference", async () => {
    const onPreferenceChange = vi.fn();
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        <I18nProvider
          preference="system"
          systemLanguages={["en-US"]}
          onPreferenceChange={onPreferenceChange}
        >
          <LanguageSettingsPanel />
        </I18nProvider>,
      );
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("Language");
    expect(text).toContain("Follow system");
    expect(text).toContain("Simplified Chinese");
    expect(text).toContain("繁體中文");
    expect(text).toContain("English");
    expect(text).toContain("日本語");
    expect(text).toContain("Deutsch");
    expect(text).toContain("Русский");

    const group = renderer!.root.findByProps({ role: "radiogroup", "aria-label": "Language" });
    expect(group.props.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");

    const radios = renderer!.root.findAll((node) => node.type === "button" && node.props.role === "radio");
    expect(radios).toHaveLength(7);
    expect(radios[0]?.props["aria-checked"]).toBe(true);

    const simplifiedChinese = radios.find((node) =>
      node.findAll(
        (child) => child.type === "span" && child.children.includes("Simplified Chinese"),
      ).length > 0,
    );
    expect(simplifiedChinese).toBeDefined();

    await act(async () => {
      simplifiedChinese!.props.onClick();
    });

    expect(onPreferenceChange).toHaveBeenCalledWith("zh-CN");
  });
});
