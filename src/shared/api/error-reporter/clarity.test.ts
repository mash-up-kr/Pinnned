import { describe, expect, it } from "vitest"

import { clarityErrorTag } from "./clarity"

describe("clarityErrorTag", () => {
  it("종류와 메시지 앞 60자로 태그 값을 만든다", () => {
    expect(
      clarityErrorTag({
        kind: "js-error",
        message: "Cannot read properties of undefined (reading 'id')",
      })
    ).toBe("js-error: Cannot read properties of undefined (reading 'id')")
    expect(
      clarityErrorTag({ kind: "api-failure", message: "x".repeat(100) })
    ).toHaveLength("api-failure: ".length + 60)
  })
})
