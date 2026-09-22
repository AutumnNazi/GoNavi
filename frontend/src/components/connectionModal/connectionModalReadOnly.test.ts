import { describe, expect, it } from "vitest";

import {
  allReadOnlyProtectionChecked,
  readOnlyProtectionFields,
  toggleAllReadOnlyProtection,
  type ReadOnlyProtectionState,
} from "./connectionModalReadOnly";

const ALL_ON: ReadOnlyProtectionState = {
  restrictDataEdit: true,
  restrictStructureEdit: true,
  restrictScriptExecution: true,
  restrictDataImport: true,
};

const ALL_OFF: ReadOnlyProtectionState = {
  restrictDataEdit: false,
  restrictStructureEdit: false,
  restrictScriptExecution: false,
  restrictDataImport: false,
};

describe("connectionModalReadOnly 「仅只读」总开关 (#1325)", () => {
  it("lists the four sub-items for standard connections and three for nacos", () => {
    expect(readOnlyProtectionFields(true)).toEqual([
      "restrictDataEdit",
      "restrictStructureEdit",
      "restrictScriptExecution",
      "restrictDataImport",
    ]);
    expect(readOnlyProtectionFields(false)).toEqual([
      "restrictDataEdit",
      "restrictStructureEdit",
      "restrictDataImport",
    ]);
  });

  it("turns every applicable sub-item on from an all-off state", () => {
    expect(allReadOnlyProtectionChecked(ALL_OFF, true)).toBe(false);
    expect(toggleAllReadOnlyProtection(ALL_OFF, true)).toEqual(ALL_ON);
  });

  it("turns every applicable sub-item off from an all-on state", () => {
    expect(allReadOnlyProtectionChecked(ALL_ON, true)).toBe(true);
    expect(toggleAllReadOnlyProtection(ALL_ON, true)).toEqual(ALL_OFF);
  });

  it("derives off while any applicable sub-item is unchecked", () => {
    const partial = { ...ALL_ON, restrictScriptExecution: false };
    expect(allReadOnlyProtectionChecked(partial, true)).toBe(false);
    // and toggling from partial lifts the remaining sub-item rather than clearing
    expect(toggleAllReadOnlyProtection(partial, true)).toEqual(ALL_ON);
  });

  it("leaves the script-execution field alone on nacos connections", () => {
    // nacos: script execution is not a panel row, so the master must not touch it
    const nacosState = { ...ALL_OFF, restrictScriptExecution: true };
    expect(readOnlyProtectionFields(false)).not.toContain("restrictScriptExecution");
    expect(toggleAllReadOnlyProtection(nacosState, false)).toEqual({
      restrictDataEdit: true,
      restrictStructureEdit: true,
      restrictScriptExecution: true, // untouched
      restrictDataImport: true,
    });
  });
});
