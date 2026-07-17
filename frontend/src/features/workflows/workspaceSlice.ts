import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { Locale, ThemeMode } from "../../types";

interface SelectionState {
  recordId: string | null;
  cellKey: string | null;
}

interface WorkspaceState {
  locale: Locale;
  theme: ThemeMode;
  selectedGroup: string;
  selectedWorkflow: string;
  selection: SelectionState;
  search: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
}

const savedLocale = window.localStorage.getItem("orbit:locale") as Locale | null;
const savedTheme = window.localStorage.getItem("orbit:theme") as ThemeMode | null;

const initialState: WorkspaceState = {
  locale: savedLocale && ["en", "zh-CN", "zh-HK"].includes(savedLocale)
    ? savedLocale
    : "zh-CN",
  theme: savedTheme === "dark" ? "dark" : "light",
  selectedGroup: "sales",
  selectedWorkflow: "customer-fields",
  selection: { recordId: null, cellKey: null },
  search: "",
  sortBy: "record_order",
  sortDirection: "asc",
};

const workspaceSlice = createSlice({
  name: "workspace",
  initialState,
  reducers: {
    setLocale(state, action: PayloadAction<Locale>) {
      state.locale = action.payload;
      window.localStorage.setItem("orbit:locale", action.payload);
    },
    setTheme(state, action: PayloadAction<ThemeMode>) {
      state.theme = action.payload;
      window.localStorage.setItem("orbit:theme", action.payload);
    },
    selectGroup(state, action: PayloadAction<string>) {
      state.selectedGroup = action.payload;
    },
    selectWorkflow(state, action: PayloadAction<string>) {
      state.selectedWorkflow = action.payload;
      state.selection = { recordId: null, cellKey: null };
      state.search = "";
      state.sortBy = "record_order";
      state.sortDirection = "asc";
    },
    selectCell(state, action: PayloadAction<SelectionState>) {
      state.selection = action.payload;
    },
    setSearch(state, action: PayloadAction<string>) {
      state.search = action.payload;
    },
    setSort(
      state,
      action: PayloadAction<{ sortBy: string; sortDirection: "asc" | "desc" }>,
    ) {
      state.sortBy = action.payload.sortBy;
      state.sortDirection = action.payload.sortDirection;
    },
  },
});

export const {
  selectCell,
  selectGroup,
  selectWorkflow,
  setLocale,
  setTheme,
  setSearch,
  setSort,
} = workspaceSlice.actions;

export default workspaceSlice.reducer;
