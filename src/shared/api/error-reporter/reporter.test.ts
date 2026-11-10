// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  _resetForTests,
  installErrorReporter,
  reportApiFailure,
  reportError,
  setCurrentRoute,
} from "./reporter"
import type { ErrorReport } from "./reporter"

const beaconMock = vi.fn<(url: string, data: Blob) => boolean>()
const fetchMock = vi.fn<typeof fetch>()

async function sentBodies(): Promise<Array<ErrorReport>> {
  return Promise.all(
    beaconMock.mock.calls.map(async ([, blob]) => JSON.parse(await blob.text()))
  )
}

describe("error reporter", () => {
  beforeEach(() => {
    _resetForTests()
    beaconMock.mockReturnValue(true)
    Object.defineProperty(navigator, "sendBeacon", {
      value: beaconMock,
      configurable: true,
      writable: true,
    })
    vi.stubGlobal("fetch", fetchMock)
    // jsdom의 Blob에는 text()가 없다 — 본문 확인용으로 Node Blob을 쓴다
    vi.stubGlobal("Blob", NodeBlob)
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    installErrorReporter({ isAuthenticated: () => true, enabled: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    beaconMock.mockReset()
    fetchMock.mockReset()
  })

  it("reportError는 /report-error로 js-error 리포트를 보낸다", async () => {
    reportError(new Error("boom"))

    expect(beaconMock).toHaveBeenCalledTimes(1)
    expect(beaconMock.mock.calls[0][0]).toBe("/report-error")
    const [body] = await sentBodies()
    expect(body.kind).toBe("js-error")
    expect(body.message).toBe("boom")
    expect(body.name).toBe("Error")
    expect(body.authenticated).toBe(true)
    expect(body.appVersion).toEqual(expect.any(String))
    expect(body.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(body.userAgent).toEqual(expect.any(String))
  })

  it("window error 이벤트를 js-error로 보낸다", async () => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("ev") }))

    const [body] = await sentBodies()
    expect(body.kind).toBe("js-error")
    expect(body.message).toBe("ev")
  })

  it("unhandledrejection 이벤트를 promise-rejection으로 보낸다", async () => {
    const event = new Event("unhandledrejection") as Event & {
      reason: unknown
    }
    event.reason = new Error("rejected")
    window.dispatchEvent(event)

    const [body] = await sentBodies()
    expect(body.kind).toBe("promise-rejection")
    expect(body.message).toBe("rejected")
  })

  it("같은 에러는 세션당 한 번만 보낸다", () => {
    const error = new Error("dup")
    reportError(error)
    reportError(error)

    expect(beaconMock).toHaveBeenCalledTimes(1)
  })

  it("세션당 전송 상한은 20건이다", () => {
    for (let i = 0; i < 25; i++) reportError(new Error(`e${i}`))

    expect(beaconMock).toHaveBeenCalledTimes(20)
  })

  it("노이즈 필터에 걸리는 에러는 보내지 않는다", () => {
    reportError(new Error("Script error."))

    expect(beaconMock).not.toHaveBeenCalled()
  })

  it("브레드크럼은 최근 라우트 5개, routePattern은 현재 라우트다", async () => {
    for (const path of ["/a", "/b", "/c", "/d", "/e", "/f"])
      setCurrentRoute(path)
    reportError(new Error("x"))

    const [body] = await sentBodies()
    expect(body.breadcrumbs).toEqual(["/b", "/c", "/d", "/e", "/f"])
    expect(body.routePattern).toBe("/f")
  })

  it("sendBeacon이 없으면 keepalive fetch로 보낸다", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    })
    reportError(new Error("no beacon"))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/report-error")
    expect(init).toMatchObject({ method: "POST", keepalive: true })
  })

  it("전송 실패는 삼키고 재귀 보고하지 않는다", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    })
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    reportError(new Error("first"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("enabled=false면 아무것도 보내지 않는다", () => {
    _resetForTests()
    installErrorReporter({ isAuthenticated: () => false, enabled: false })
    reportError(new Error("off"))

    expect(beaconMock).not.toHaveBeenCalled()
  })

  it("reportApiFailure는 api-failure 리포트를 보낸다", async () => {
    reportApiFailure({ protocol: "graphql", name: "MyPots", status: 500 })

    const [body] = await sentBodies()
    expect(body.kind).toBe("api-failure")
    expect(body.api).toEqual({
      protocol: "graphql",
      name: "MyPots",
      status: 500,
    })
  })

  it("Clarity가 있으면 세션에 error 태그를 달고 녹화를 우선 저장시킨다", () => {
    const clarityMock = vi.fn()
    vi.stubGlobal("clarity", clarityMock)
    reportError(new Error("tagged"))

    expect(clarityMock).toHaveBeenCalledWith("set", "error", "js-error: tagged")
    expect(clarityMock).toHaveBeenCalledWith("upgrade", "error")
  })

  it("Clarity가 없어도 전송은 정상이다", () => {
    vi.stubGlobal("clarity", undefined)
    reportError(new Error("no clarity"))

    expect(beaconMock).toHaveBeenCalledTimes(1)
  })

  it("render-error와 componentStack을 그대로 싣는다", async () => {
    reportError(new Error("render"), {
      kind: "render-error",
      componentStack: "at Foo",
    })

    const [body] = await sentBodies()
    expect(body.kind).toBe("render-error")
    expect(body.componentStack).toBe("at Foo")
  })
})
