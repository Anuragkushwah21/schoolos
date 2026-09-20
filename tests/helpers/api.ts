import { NextRequest } from "next/server";

/**
 * Call a Route Handler the way Next.js does, so tests exercise the real
 * authentication, scoping and error mapping rather than a stand-in.
 */
export function apiRequest(
  url: string,
  init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");

  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

type Handler<P> = (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>;

export async function callApi<P extends Record<string, string> = Record<string, never>>(
  handler: Handler<P>,
  request: NextRequest,
  params: P = {} as P,
): Promise<{ status: number; body: { data?: unknown; meta?: unknown; error?: { code: string; message: string; fieldErrors?: Record<string, string[]> } } }> {
  const response = await handler(request, { params: Promise.resolve(params) });
  return { status: response.status, body: await response.json() };
}
