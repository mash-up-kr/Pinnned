import { describe, expect, it } from "vitest"

import { computeFingerprint, normalizeMessage } from "./fingerprint"

describe("normalizeMessage", () => {
  it("숫자를 #, 따옴표 안 문자열을 빈 따옴표로 바꾼다", () => {
    expect(normalizeMessage("Cannot read 'id' of user 12345")).toBe(
      'Cannot read "" of user #'
    )
  })

  it("URL과 UUID를 자리표시자로 바꾼다", () => {
    expect(
      normalizeMessage(
        "GET https://x.com/a/550e8400-e29b-41d4-a716-446655440000 failed"
      )
    ).toBe("GET <url> failed")
    expect(normalizeMessage("pot 550e8400-e29b-41d4-a716-446655440000")).toBe(
      "pot <id>"
    )
  })
})

describe("computeFingerprint", () => {
  const base = {
    kind: "js-error" as const,
    name: "TypeError",
    message: "Cannot read properties of undefined (reading 'id')",
    routePattern: "/my-page/pot/$potId",
  }

  it("16자리 hex를 돌려주고 같은 입력엔 같은 값이다", async () => {
    const a = await computeFingerprint(base, "src/x.tsx:10")
    const b = await computeFingerprint(base, "src/x.tsx:10")
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(a).toBe(b)
  })

  it("메시지의 숫자만 다르면 같은 지문이다", async () => {
    const a = await computeFingerprint(
      { ...base, message: "user 1 missing" },
      "src/x.tsx:10"
    )
    const b = await computeFingerprint(
      { ...base, message: "user 2 missing" },
      "src/x.tsx:10"
    )
    expect(a).toBe(b)
  })

  it("라우트가 다르면 다른 지문이다", async () => {
    const a = await computeFingerprint(base, "src/x.tsx:10")
    const b = await computeFingerprint(
      { ...base, routePattern: "/signup" },
      "src/x.tsx:10"
    )
    expect(a).not.toBe(b)
  })

  it("API 실패는 api 필드만으로 계산한다 (메시지·프레임 무시)", async () => {
    const api = { protocol: "graphql" as const, name: "MyPots", status: 500 }
    const a = await computeFingerprint(
      { kind: "api-failure", message: "first", api },
      "src/a.ts:1"
    )
    const b = await computeFingerprint(
      { kind: "api-failure", message: "second", api },
      "src/b.ts:2"
    )
    expect(a).toBe(b)
  })
})
