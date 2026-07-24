import React from "react";
import { useI18n } from "../i18n/provider";
import type { LanguagePreference } from "../i18n/types";

const groupStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 0,
  borderTop: "1px solid rgba(100, 116, 139, 0.16)",
};

const LanguageSettingsPanel: React.FC = () => {
  const { preference, setPreference, t } = useI18n();

  const options: { label: string; value: LanguagePreference }[] = [
    { label: t("settings.language.follow_system"), value: "system" },
    { label: t("settings.language.simplified_chinese"), value: "zh-CN" },
    { label: t("settings.language.traditional_chinese"), value: "zh-TW" },
    { label: t("settings.language.english"), value: "en-US" },
    { label: t("settings.language.japanese"), value: "ja-JP" },
    { label: t("settings.language.german"), value: "de-DE" },
    { label: t("settings.language.russian"), value: "ru-RU" },
  ];

  return (
    <div className="gonavi-language-settings" style={{ display: "grid", gap: 12, padding: "4px 0" }}>
      <div role="radiogroup" aria-label={t("settings.language.title")} style={groupStyle}>
        {options.map((option, optionIndex) => {
          const selected = option.value === preference;
          return (
            <button
              className={`gonavi-language-option${selected ? " is-selected" : ""}`}
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setPreference(option.value)}
              onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  return;
                }
                event.preventDefault();
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? options.length - 1
                    : event.key === 'ArrowRight' || event.key === 'ArrowDown'
                      ? (optionIndex + 1) % options.length
                      : (optionIndex - 1 + options.length) % options.length;
                setPreference(options[nextIndex].value);
                const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]');
                radios?.[nextIndex]?.focus();
              }}
            >
              <span>{option.label}</span>
              {selected && <span className="gonavi-language-option-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 'var(--gn-font-size-sm, 12px)', opacity: 0.64, lineHeight: 1.6 }}>
        {t("settings.language.restart_hint")}
      </div>
    </div>
  );
};

export default LanguageSettingsPanel;
