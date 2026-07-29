import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

import type {
  GeolocationCatalog,
  HealthResponse,
  Locale,
  RecordPage,
  SessionInfo,
  WorkflowDetail,
  WorkflowRecord,
  WorkflowCommandInput,
  WorkflowRuntimeProjection,
  WorkflowSummary,
  WorkflowTree,
  WorkflowDecisionCatalog,
  ReportTemplateSaveResponse,
} from "../types";
import type { BusinessEntityRecord, BusinessEntityResponse } from "../salesTypes";

interface RecordQuery {
  workflowKey: string;
  locale: Locale;
  search: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
  ownerOnly?: boolean;
}

interface TreeQuery {
  workflowKey: string;
  locale: Locale;
  recordId: string | null;
  cellKey: string | null;
  stepKey: string | null;
}

interface RecordUpdate {
  workflowKey: string;
  recordId: string;
  values: Record<string, unknown>;
  version: number;
  locale: Locale;
}

interface WorkflowCommand extends WorkflowCommandInput {
  instanceId: string;
}

interface AppendWorkflowStepMessage {
  workflowKey: string;
  recordId: string;
  message: string;
  locale: Locale;
}

interface WorkflowStepMessagesResponse {
  record_id: string;
  Messages: string[];
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
  tagTypes: ["Workflow", "Record", "BusinessEntities"],
  endpoints: (builder) => ({
    health: builder.query<HealthResponse, void>({
      query: () => "/health",
    }),
    geolocation: builder.query<GeolocationCatalog, void>({
      query: () => "/geolocation",
    }),
    session: builder.query<SessionInfo, Locale>({
      query: (locale) => ({ url: "/session", params: { locale } }),
    }),
    businessEntities: builder.query<BusinessEntityResponse, Locale>({
      query: (locale) => ({ url: "/admin/business-entities", params: { locale } }),
      providesTags: ["BusinessEntities"],
    }),
    createBusinessEntityRecord: builder.mutation<BusinessEntityRecord, { entityKey: string; values: Record<string, unknown> }>({
      query: ({ entityKey, values }) => ({ url: `/admin/business-entities/${entityKey}/records`, method: "POST", body: { values } }),
      invalidatesTags: ["BusinessEntities"],
    }),
    updateBusinessEntityRecord: builder.mutation<BusinessEntityRecord, { entityKey: string; recordId: string; values: Record<string, unknown>; version: number }>({
      query: ({ entityKey, recordId, values, version }) => ({ url: `/admin/business-entities/${entityKey}/records/${recordId}`, method: "PATCH", body: { values, version } }),
      invalidatesTags: ["BusinessEntities"],
    }),
    deleteBusinessEntityRecord: builder.mutation<void, { entityKey: string; recordId: string }>({
      query: ({ entityKey, recordId }) => ({ url: `/admin/business-entities/${entityKey}/records/${recordId}`, method: "DELETE" }),
      invalidatesTags: ["BusinessEntities"],
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
    workflowDecisionOptions: builder.query<WorkflowDecisionCatalog[], { workflowKey: string; locale: Locale }>({
      query: ({ workflowKey, locale }) => ({
        url: `/workflows/${workflowKey}/decision-options`,
        params: { locale },
      }),
    }),
    records: builder.query<RecordPage, RecordQuery>({
      query: ({ workflowKey, locale, search, sortBy, sortDirection, ownerOnly }) => ({
        url: `/workflows/${workflowKey}/records`,
        params: {
          locale,
          limit: 500,
          search: search || undefined,
          sort_by: sortBy,
          sort_direction: sortDirection,
          owner_only: ownerOnly || undefined,
        },
      }),
      providesTags: (_result, _error, argument) => [
        { type: "Record", id: argument.workflowKey },
      ],
    }),
    workflowTree: builder.query<WorkflowTree, TreeQuery>({
      query: ({ workflowKey, locale, recordId, cellKey, stepKey }) => ({
        url: `/workflows/${workflowKey}/tree`,
        params: {
          locale,
          selected_record_id: recordId || undefined,
          selected_cell_key: cellKey || undefined,
          selected_step_key: stepKey || undefined,
        },
      }),
    }),
    appendWorkflowStepMessage: builder.mutation<WorkflowStepMessagesResponse, AppendWorkflowStepMessage>({
      query: ({ workflowKey, recordId, message, locale }) => ({
        url: `/workflows/${workflowKey}/steps/${recordId}/messages`,
        method: "POST",
        body: { message, locale },
      }),
    }),
    reportTemplate: builder.query<string, { customerRelations: string; workflowKey: string; recordKey: string; theme?: string }>({
      query: ({ customerRelations, workflowKey, recordKey, theme }) => ({
        url: "/GenerateReportTemplate",
        params: { customerRelations, workflow_key: workflowKey, record_key: recordKey, theme },
      responseHandler: (response) => response.text(),
      }),
    }),
    reportStylesheet: builder.query<string, void>({
      query: () => ({ url: "/GenerateReportTemplate/stylesheet.xsl", responseHandler: (response) => response.text() }),
    }),
    saveReportTemplate: builder.mutation<ReportTemplateSaveResponse, { customerRelations: string; workflowKey: string; recordKey: string; theme?: string }>({
      query: ({ customerRelations, workflowKey, recordKey, theme }) => ({
        url: "/GenerateReportTemplate/save",
        method: "POST",
        body: { customerRelations, workflow_key: workflowKey, record_key: recordKey, theme },
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
    workflowRuntime: builder.query<WorkflowRuntimeProjection, { instanceId: string; workflowKey: string }>({
      query: ({ instanceId, workflowKey }) => ({
        url: `/workflows/instances/${instanceId}/runtime`, params: { workflow_key: workflowKey },
      }),
    }),
    workflowCommand: builder.mutation<WorkflowRuntimeProjection, WorkflowCommand>({
      query: ({ instanceId, command, nodeKey, payload, reason, version }) => ({
        url: `/workflows/instances/${instanceId}/commands`,
        method: "POST",
        body: { command, node_key: nodeKey, payload: payload || {}, reason, version },
      }),
    }),
  }),
});

// Endpoint-local hooks avoid TypeScript 7's unique-symbol declaration merging
// issue with RTK Query's generated top-level hook aliases.
export const useGetHealthQuery = orbitApi.endpoints.health.useQuery;
export const useGetGeolocationQuery = orbitApi.endpoints.geolocation.useQuery;
export const useGetSessionQuery = orbitApi.endpoints.session.useQuery;
export const useGetBusinessEntitiesQuery = orbitApi.endpoints.businessEntities.useQuery;
export const useCreateBusinessEntityRecordMutation = orbitApi.endpoints.createBusinessEntityRecord.useMutation;
export const useUpdateBusinessEntityRecordMutation = orbitApi.endpoints.updateBusinessEntityRecord.useMutation;
export const useDeleteBusinessEntityRecordMutation = orbitApi.endpoints.deleteBusinessEntityRecord.useMutation;
export const useGetWorkflowQuery = orbitApi.endpoints.workflow.useQuery;
export const useGetWorkflowDecisionOptionsQuery = orbitApi.endpoints.workflowDecisionOptions.useQuery;
export const useGetWorkflowTreeQuery = orbitApi.endpoints.workflowTree.useQuery;
export const useGetWorkflowsQuery = orbitApi.endpoints.workflows.useQuery;
export const useGetRecordsQuery = orbitApi.endpoints.records.useQuery;
export const useLazyGetRecordsQuery = orbitApi.endpoints.records.useLazyQuery;
export const useUpdateRecordMutation = orbitApi.endpoints.updateRecord.useMutation;
export const useCreateRecordMutation = orbitApi.endpoints.createRecord.useMutation;
export const useDeleteRecordMutation = orbitApi.endpoints.deleteRecord.useMutation;
export const useGetWorkflowRuntimeQuery = orbitApi.endpoints.workflowRuntime.useQuery;
export const useWorkflowCommandMutation = orbitApi.endpoints.workflowCommand.useMutation;
export const useAppendWorkflowStepMessageMutation = orbitApi.endpoints.appendWorkflowStepMessage.useMutation;
export const useGetReportTemplateQuery = orbitApi.endpoints.reportTemplate.useLazyQuery;
export const useGetReportStylesheetQuery = orbitApi.endpoints.reportStylesheet.useLazyQuery;
export const useSaveReportTemplateMutation = orbitApi.endpoints.saveReportTemplate.useMutation;
