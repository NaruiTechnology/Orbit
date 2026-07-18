import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

import type {
  HealthResponse,
  Locale,
  RecordPage,
  SessionInfo,
  WorkflowDetail,
  WorkflowRecord,
  WorkflowSummary,
  WorkflowTree,
} from "../types";

interface RecordQuery {
  workflowKey: string;
  locale: Locale;
  search: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
}

interface TreeQuery {
  workflowKey: string;
  locale: Locale;
  recordId: string | null;
  cellKey: string | null;
}

interface RecordUpdate {
  workflowKey: string;
  recordId: string;
  values: Record<string, unknown>;
  version: number;
  locale: Locale;
}

export const orbitApi = createApi({
  reducerPath: "orbitApi",
  baseQuery: fetchBaseQuery({
    baseUrl: "/api/v1",
    prepareHeaders: (headers) => {
      const token = localStorage.getItem("orbit:auth-token");
      if (token) headers.set("X-Orbit-Auth", token);
      return headers;
    },
  }),
  tagTypes: ["Workflow", "Record"],
  endpoints: (builder) => ({
    health: builder.query<HealthResponse, void>({
      query: () => "/health",
    }),
    session: builder.query<SessionInfo, Locale>({
      query: (locale) => ({ url: "/session", params: { locale } }),
    }),
    workflows: builder.query<WorkflowSummary[], Locale>({
      query: (locale) => ({ url: "/workflows", params: { locale } }),
      providesTags: ["Workflow"],
    }),
    workflow: builder.query<WorkflowDetail, { workflowKey: string; locale: Locale }>({
      query: ({ workflowKey, locale }) => ({
        url: `/workflows/${workflowKey}`,
        params: { locale },
      }),
      providesTags: (_result, _error, argument) => [
        { type: "Workflow", id: argument.workflowKey },
      ],
    }),
    records: builder.query<RecordPage, RecordQuery>({
      query: ({ workflowKey, locale, search, sortBy, sortDirection }) => ({
        url: `/workflows/${workflowKey}/records`,
        params: {
          locale,
          limit: 500,
          search: search || undefined,
          sort_by: sortBy,
          sort_direction: sortDirection,
        },
      }),
      providesTags: (_result, _error, argument) => [
        { type: "Record", id: argument.workflowKey },
      ],
    }),
    workflowTree: builder.query<WorkflowTree, TreeQuery>({
      query: ({ workflowKey, locale, recordId, cellKey }) => ({
        url: `/workflows/${workflowKey}/tree`,
        params: {
          locale,
          selected_record_id: recordId || undefined,
          selected_cell_key: cellKey || undefined,
        },
      }),
    }),
    updateRecord: builder.mutation<WorkflowRecord, RecordUpdate>({
      query: ({ workflowKey, recordId, values, version, locale }) => ({
        url: `/workflows/${workflowKey}/records/${recordId}`,
        method: "PATCH",
        body: { values, version, locale },
      }),
      invalidatesTags: (_result, _error, argument) => [
        { type: "Record", id: argument.workflowKey },
      ],
    }),
    createRecord: builder.mutation<WorkflowRecord, { workflowKey: string; values: Record<string, unknown>; locale: Locale }>({
      query: ({ workflowKey, values, locale }) => ({
        url: `/workflows/${workflowKey}/records`, method: "POST", body: { values, locale },
      }),
      invalidatesTags: (_result, _error, argument) => [{ type: "Record", id: argument.workflowKey }, "Workflow"],
    }),
    deleteRecord: builder.mutation<void, { workflowKey: string; recordId: string }>({
      query: ({ workflowKey, recordId }) => ({ url: `/workflows/${workflowKey}/records/${recordId}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, argument) => [{ type: "Record", id: argument.workflowKey }, "Workflow"],
    }),
  }),
});

// Endpoint-local hooks avoid TypeScript 7's unique-symbol declaration merging
// issue with RTK Query's generated top-level hook aliases.
export const useGetHealthQuery = orbitApi.endpoints.health.useQuery;
export const useGetSessionQuery = orbitApi.endpoints.session.useQuery;
export const useGetWorkflowQuery = orbitApi.endpoints.workflow.useQuery;
export const useGetWorkflowTreeQuery = orbitApi.endpoints.workflowTree.useQuery;
export const useGetWorkflowsQuery = orbitApi.endpoints.workflows.useQuery;
export const useGetRecordsQuery = orbitApi.endpoints.records.useQuery;
export const useUpdateRecordMutation = orbitApi.endpoints.updateRecord.useMutation;
export const useCreateRecordMutation = orbitApi.endpoints.createRecord.useMutation;
export const useDeleteRecordMutation = orbitApi.endpoints.deleteRecord.useMutation;
