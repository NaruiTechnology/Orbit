import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";

import { orbitApi } from "./orbitApi";
import workspaceReducer from "../features/workflows/workspaceSlice";

export const store = configureStore({
  reducer: {
    workspace: workspaceReducer,
    [orbitApi.reducerPath]: orbitApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(orbitApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

