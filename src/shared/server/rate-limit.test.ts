import { describe, expect, it } from "vitest"

import { createRateLimiter } from "./rate-limit"

describe("createRateLimiter", () => {
  it("윈도 안에서 limit번까지만 허용한다", () => {
    let now = 1_000
    const allow = createRateLimiter(3, 60_000, () => now)

    expect([allow(), allow(), allow(), allow()]).toEqual([
      true,
      true,
      true,
      false,
    ])
    now += 60_000
    expect(allow()).toBe(true)
  })
})
