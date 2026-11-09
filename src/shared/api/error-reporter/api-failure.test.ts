import { GraphQLError } from "graphql"
import { ClientError } from "graphql-request"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  normalizeRestPath,
  reportGraphQLResponse,
  reportRestFailure,
} from "./api-failure"

const { reportApiFailureMock } = vi.hoisted(() => ({
  reportApiFailureMock: vi.fn(),
}))

vi.mock("./reporter", () => ({
  reportApiFailure: reportApiFailureMock,
}))

function clientError(status: number, code?: string) {
  return new ClientError(
    {
      status,
      headers: new Headers(),
      body: "",
      query: "",
      errors: [new GraphQLError("x", { extensions: code ? { code } : {} })],
    },
    { query: "" }
  )
}

describe("reportGraphQLResponse", () => {
  afterEach(() => vi.clearAllMocks())

  it("GraphQL 에러 응답을 operationName·status·code와 함께 보고한다", () => {
    reportGraphQLResponse(clientError(200, "NOT_FOUND"), {
      operationName: "MyPots",
    })

    expect(reportApiFailureMock).toHaveBeenCalledTimes(1)
    expect(reportApiFailureMock.mock.calls[0][0]).toEqual({
      protocol: "graphql",
      name: "MyPots",
      status: 200,
      code: "NOT_FOUND",
    })
  })

  it("401은 정상 흐름(토큰 만료)이라 보고하지 않는다", () => {
    reportGraphQLResponse(clientError(401), { operationName: "MyPots" })

    expect(reportApiFailureMock).not.toHaveBeenCalled()
  })

  it("네트워크 실패(fetch throw)는 status 없이 보고한다", () => {
    reportGraphQLResponse(new TypeError("Failed to fetch"), {
      operationName: "MyPots",
    })

    expect(reportApiFailureMock.mock.calls[0][0]).toEqual({
      protocol: "graphql",
      name: "MyPots",
      status: undefined,
      code: undefined,
    })
  })

  it("정상 응답은 보고하지 않는다", () => {
    reportGraphQLResponse({ status: 200 }, { operationName: "MyPots" })

    expect(reportApiFailureMock).not.toHaveBeenCalled()
  })
})

describe("reportRestFailure", () => {
  afterEach(() => vi.clearAllMocks())

  it("5xx는 '메서드 경로'와 status로 보고한다", () => {
    reportRestFailure("POST", "/api/auth/exchange", { status: 502 })

    expect(reportApiFailureMock.mock.calls[0][0]).toEqual({
      protocol: "rest",
      name: "POST /api/auth/exchange",
      status: 502,
    })
  })

  it("4xx는 보고하지 않는다", () => {
    reportRestFailure("POST", "/api/auth/exchange", { status: 400 })

    expect(reportApiFailureMock).not.toHaveBeenCalled()
  })

  it("외부 presigned URL 실패는 서명 쿼리를 떼고 ID를 치환해 보고한다", () => {
    reportRestFailure(
      "PUT",
      "https://bucket.s3.ap-northeast-2.amazonaws.com/img/123?X-Amz-Signature=abc",
      { error: new TypeError("Failed to fetch") }
    )

    expect(reportApiFailureMock.mock.calls[0][0]).toEqual({
      protocol: "rest",
      name: "PUT https://bucket.s3.ap-northeast-2.amazonaws.com/img/:id",
      status: undefined,
    })
  })
})

describe("normalizeRestPath", () => {
  it("ID 세그먼트가 없으면 그대로 둔다", () => {
    expect(normalizeRestPath("/api/auth/refresh")).toBe("/api/auth/refresh")
  })

  it("숫자·UUID 세그먼트를 :id로 바꾼다", () => {
    expect(normalizeRestPath("/api/users/42/posts")).toBe(
      "/api/users/:id/posts"
    )
    expect(
      normalizeRestPath("/api/x/550e8400-e29b-41d4-a716-446655440000")
    ).toBe("/api/x/:id")
  })
})
