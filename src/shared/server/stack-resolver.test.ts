import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createMapFetcher, resolveStack } from "./stack-resolver"

// esbuild --minify로 만든 실제 맵. 'new Error'는 번들 1:68(1-based) → src/sample.ts 7행 9열
const FIXTURE_MAP = readFileSync(
  new URL("./__fixtures__/sample.js.map", import.meta.url),
  "utf8"
)
const BUNDLE_URL = "https://www.pinnned.co.kr/assets/sample-abc.js"
const MINIFIED_STACK = `Error: boom from sample\n    at t (${BUNDLE_URL}:1:68)\n    at o (${BUNDLE_URL}:1:35)`

describe("resolveStack", () => {
  it("번들 프레임을 원본 파일·줄·열로 바꾸고 최상위 프레임을 돌려준다", async () => {
    const fetchMap = vi.fn(() => Promise.resolve(FIXTURE_MAP))

    const result = await resolveStack(MINIFIED_STACK, { fetchMap })

    expect(fetchMap).toHaveBeenCalledWith(`${BUNDLE_URL}.map`)
    expect(result.resolved).toBe(true)
    expect(result.text).toContain("src/sample.ts:7:9")
    expect(result.text).toContain("src/sample.ts:3:30")
    expect(result.topFrame).toBe("src/sample.ts:7")
  })

  it("맵을 못 가져오면 원본 스택 그대로 resolved=false", async () => {
    const result = await resolveStack(MINIFIED_STACK, {
      fetchMap: () => Promise.resolve(null),
    })

    expect(result.resolved).toBe(false)
    expect(result.text).toBe(MINIFIED_STACK)
    expect(result.topFrame).toBeUndefined()
  })

  it("서드파티 프레임은 복원을 시도하지 않는다", async () => {
    const fetchMap = vi.fn(() => Promise.resolve(FIXTURE_MAP))
    const stack =
      "Error: x\n    at https://www.clarity.ms/tag/abc.js:1:10\n    at chrome-extension://abc/content.js:3:4"

    const result = await resolveStack(stack, { fetchMap })

    expect(fetchMap).not.toHaveBeenCalled()
    expect(result.resolved).toBe(false)
    expect(result.text).toBe(stack)
  })
})

describe("createMapFetcher", () => {
  const fetchMock = vi.fn<typeof fetch>()

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it("같은 맵은 한 번만 내려받는다", async () => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response(FIXTURE_MAP, { status: 200 }))
    const fetchMap = createMapFetcher("https://www.pinnned.co.kr")

    const first = await fetchMap(`${BUNDLE_URL}.map`)
    const second = await fetchMap(`${BUNDLE_URL}.map`)

    expect(first).toBe(FIXTURE_MAP)
    expect(second).toBe(FIXTURE_MAP)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("404면 null", async () => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response("", { status: 404 }))
    const fetchMap = createMapFetcher("https://www.pinnned.co.kr")

    expect(await fetchMap(`${BUNDLE_URL}.map`)).toBeNull()
  })

  it("fetch 예외도 null", async () => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockRejectedValue(new TypeError("network"))
    const fetchMap = createMapFetcher("https://www.pinnned.co.kr")

    expect(await fetchMap(`${BUNDLE_URL}.map`)).toBeNull()
  })
})

describe("resolveStack — 깨진 맵", () => {
  it("맵이 JSON이 아니면 throw 없이 원본 스택을 돌려준다", async () => {
    const result = await resolveStack(MINIFIED_STACK, {
      fetchMap: () => Promise.resolve("<html>not a map</html>"),
    })

    expect(result.resolved).toBe(false)
    expect(result.text).toBe(MINIFIED_STACK)
  })
})

describe("createMapFetcher — 타임아웃", () => {
  it("fetch에 타임아웃 signal을 붙인다", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue(new Response(FIXTURE_MAP, { status: 200 }))

    await createMapFetcher("https://www.pinnned.co.kr")(`${BUNDLE_URL}.map`)

    const init = fetchMock.mock.calls[0][1]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    vi.unstubAllGlobals()
  })
})
