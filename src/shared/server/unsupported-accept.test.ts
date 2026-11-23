import { describe, expect, it } from "vitest"

import {
  isUnsupportedAcceptResponse,
  notAcceptableResponse,
} from "./unsupported-accept"

describe("isUnsupportedAcceptResponse", () => {
  it("프레임워크의 'Only HTML requests' 500 응답을 알아본다", async () => {
    const response = Response.json(
      { error: "Only HTML requests are supported here" },
      { status: 500 }
    )
    expect(await isUnsupportedAcceptResponse(response)).toBe(true)
    // clone으로 읽었으므로 원본 본문은 그대로 읽힌다
    expect(await response.json()).toEqual({
      error: "Only HTML requests are supported here",
    })
  })

  it("다른 500 응답은 알아보지 않는다", async () => {
    expect(
      await isUnsupportedAcceptResponse(
        Response.json({ error: "boom" }, { status: 500 })
      )
    ).toBe(false)
    expect(
      await isUnsupportedAcceptResponse(
        new Response("Internal Server Error", { status: 500 })
      )
    ).toBe(false)
    expect(
      await isUnsupportedAcceptResponse(
        Response.json(
          { error: "Only HTML requests are supported here" },
          { status: 404 }
        )
      )
    ).toBe(false)
  })

  it("406 응답을 만든다", () => {
    expect(notAcceptableResponse().status).toBe(406)
  })
})
