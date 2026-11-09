import { ClientError } from "graphql-request"

import { reportApiFailure } from "./reporter"

/** 토큰 만료 401은 authFetch가 refresh로 처리하는 정상 흐름이다. */
const IGNORED_GRAPHQL_STATUSES = new Set([401])

/**
 * graphql-request의 responseMiddleware에 그대로 넘긴다. GraphQL 에러·5xx·네트워크 실패만 보고한다.
 * 정상 응답 객체는 ClientError도 Error도 아니므로 아무것도 하지 않는다.
 */
export function reportGraphQLResponse(
  response: ClientError | Error | { status: number },
  request: { operationName?: string }
): void {
  const name = request.operationName ?? "unknown"

  if (response instanceof ClientError) {
    const status = response.response.status
    if (IGNORED_GRAPHQL_STATUSES.has(status)) return
    const extensions = response.response.errors?.[0]?.extensions as
      | { code?: string }
      | undefined
    reportApiFailure(
      { protocol: "graphql", name, status, code: extensions?.code },
      response
    )
    return
  }

  if (response instanceof Error) {
    reportApiFailure(
      { protocol: "graphql", name, status: undefined, code: undefined },
      response
    )
  }
}

const ID_SEGMENT =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** 쿼리스트링을 떼고 숫자·UUID 세그먼트를 :id로 바꾼다. 절대 URL은 origin을 유지한다. */
export function normalizeRestPath(path: string): string {
  const [withoutQuery] = path.split("?")
  const isAbsolute = /^https?:\/\//.test(withoutQuery)
  const origin = isAbsolute ? new URL(withoutQuery).origin : ""
  const pathname = isAbsolute ? new URL(withoutQuery).pathname : withoutQuery
  const normalized = pathname
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
    .join("/")
  return origin + normalized
}

/** REST 호출부용. 5xx 또는 fetch 예외만 보고한다 (4xx는 정상 흐름). */
export function reportRestFailure(
  method: string,
  path: string,
  outcome: { status: number } | { error: unknown }
): void {
  const name = `${method} ${normalizeRestPath(path)}`
  if ("status" in outcome) {
    if (outcome.status < 500) return
    reportApiFailure({ protocol: "rest", name, status: outcome.status })
    return
  }
  reportApiFailure({ protocol: "rest", name, status: undefined }, outcome.error)
}
