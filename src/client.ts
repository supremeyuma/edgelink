import type { components, paths } from "../openapi/generated";

type Schemas = components["schemas"];

export type Link = Schemas["Link"];
export type LinkList = Schemas["LinkList"];
export type LinkResponse = Schemas["LinkResponse"];
export type CreateLinkRequest = Schemas["CreateLinkRequest"];
export type UpdateLinkRequest = Schemas["UpdateLinkRequest"];
export type Analytics = Schemas["Analytics"];

type ListLinksResponse = paths["/v1/links"]["get"]["responses"][200]["content"]["application/json"];
type CreateLinkResponse =
  paths["/v1/links"]["post"]["responses"][201]["content"]["application/json"];
type UpdateLinkResponse =
  paths["/v1/links/{slug}"]["patch"]["responses"][200]["content"]["application/json"];
type AnalyticsResponse =
  paths["/v1/links/{slug}/analytics"]["get"]["responses"][200]["content"]["application/json"];

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/**
 * Typed client generated from openapi/openapi.yaml. Used by the dashboard's
 * data layer and as compile-time proof that the spec matches the API contract.
 */
export function createApiClient({ baseUrl, token, fetchImpl = fetch }: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    listLinks: () => request<ListLinksResponse>("/v1/links"),
    createLink: (body: CreateLinkRequest) =>
      request<CreateLinkResponse>("/v1/links", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateLink: (slug: string, body: UpdateLinkRequest) =>
      request<UpdateLinkResponse>(`/v1/links/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    analytics: (slug: string, days = 30) =>
      request<AnalyticsResponse>(`/v1/links/${encodeURIComponent(slug)}/analytics?days=${days}`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
