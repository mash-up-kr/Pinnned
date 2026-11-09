import { afterEach, describe, expect, it, vi } from "vitest"

import { QA_PROPS, createQaNotionClient } from "./qa-notion"

const ENV = { token: "ntn_test", databaseId: "db-1" }
const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status })
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  }
}

describe("createQaNotionClient", () => {
  afterEach(() => fetchMock.mockReset())

  it("findByFingerprint는 지문으로 DB를 조회해 행 정보를 돌려준다", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        results: [
          {
            id: "page-1",
            properties: {
              [QA_PROPS.count]: { number: 3 },
              [QA_PROPS.status]: { select: { name: "신규" } },
            },
          },
        ],
      })
    )
    const client = createQaNotionClient(ENV, fetchMock)

    const row = await client.findByFingerprint("abc")

    expect(row).toEqual({ pageId: "page-1", count: 3, status: "신규" })
    const call = lastCall()
    expect(call.url).toBe("https://api.notion.com/v1/databases/db-1/query")
    expect(call.method).toBe("POST")
    expect(call.headers.Authorization).toBe("Bearer ntn_test")
    expect(call.headers["Notion-Version"]).toBe("2022-06-28")
    expect(call.body.filter).toEqual({
      property: QA_PROPS.fingerprint,
      rich_text: { equals: "abc" },
    })
  })

  it("findByFingerprint는 결과가 없으면 null", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { results: [] }))
    const client = createQaNotionClient(ENV, fetchMock)

    expect(await client.findByFingerprint("none")).toBeNull()
  })

  it("createRow는 신규·자동수집·횟수 1로 페이지를 만든다", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "new" }))
    const client = createQaNotionClient(ENV, fetchMock)

    await client.createRow({
      title: "[js-error] boom",
      kind: "js-error",
      route: "/signup",
      fingerprint: "abc",
      appVersion: "1234567",
      occurredAt: "2026-11-10T01:00:00.000Z",
      stackText: "Error: boom\n    at src/x.tsx:1:2",
    })

    const call = lastCall()
    expect(call.url).toBe("https://api.notion.com/v1/pages")
    expect(call.body.parent).toEqual({ database_id: "db-1" })
    const props = call.body.properties as Record<string, unknown>
    expect(props[QA_PROPS.title]).toEqual({
      title: [{ text: { content: "[js-error] boom" } }],
    })
    expect(props[QA_PROPS.status]).toEqual({ select: { name: "신규" } })
    expect(props[QA_PROPS.source]).toEqual({ select: { name: "자동수집" } })
    expect(props[QA_PROPS.kind]).toEqual({ select: { name: "js-error" } })
    expect(props[QA_PROPS.route]).toEqual({
      rich_text: [{ text: { content: "/signup" } }],
    })
    expect(props[QA_PROPS.count]).toEqual({ number: 1 })
    expect(props[QA_PROPS.firstSeen]).toEqual({
      date: { start: "2026-11-10T01:00:00.000Z" },
    })
    expect(props[QA_PROPS.lastSeen]).toEqual({
      date: { start: "2026-11-10T01:00:00.000Z" },
    })
    expect(props[QA_PROPS.fingerprint]).toEqual({
      rich_text: [{ text: { content: "abc" } }],
    })
    expect(props[QA_PROPS.appVersion]).toEqual({
      rich_text: [{ text: { content: "1234567" } }],
    })
    expect(props[QA_PROPS.stack]).toEqual({
      rich_text: [{ text: { content: "Error: boom\n    at src/x.tsx:1:2" } }],
    })
    expect(call.body.children).toBeUndefined()
  })

  it("createRow는 2,000자가 넘는 스택을 속성엔 잘라 넣고 본문 코드 블록에 전체를 둔다", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "new" }))
    const client = createQaNotionClient(ENV, fetchMock)
    const long = "x".repeat(4500)

    await client.createRow({
      title: "t",
      kind: "js-error",
      fingerprint: "f",
      appVersion: "v",
      occurredAt: "2026-11-10T00:00:00.000Z",
      stackText: long,
    })

    const call = lastCall()
    const props = call.body.properties as Record<
      string,
      { rich_text: Array<{ text: { content: string } }> }
    >
    expect(props[QA_PROPS.stack].rich_text[0].text.content).toHaveLength(2000)
    const children = call.body.children as Array<{
      type: string
      code: { rich_text: Array<{ text: { content: string } }> }
    }>
    expect(children[0].type).toBe("code")
    // 코드 블록 rich_text 조각도 2,000자 제한 — 전체 텍스트가 나뉘어 들어간다
    expect(children[0].code.rich_text.map((r) => r.text.content).join("")).toBe(
      long
    )
  })

  it("bumpRow는 횟수·마지막 발생·버전을 갱신하고 reopen이면 상태를 재발로 바꾼다", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "page-1" }))
    const client = createQaNotionClient(ENV, fetchMock)

    await client.bumpRow("page-1", {
      count: 4,
      occurredAt: "2026-11-10T02:00:00.000Z",
      appVersion: "abcdef0",
      reopen: true,
    })

    const call = lastCall()
    expect(call.url).toBe("https://api.notion.com/v1/pages/page-1")
    expect(call.method).toBe("PATCH")
    const props = call.body.properties as Record<string, unknown>
    expect(props[QA_PROPS.count]).toEqual({ number: 4 })
    expect(props[QA_PROPS.lastSeen]).toEqual({
      date: { start: "2026-11-10T02:00:00.000Z" },
    })
    expect(props[QA_PROPS.appVersion]).toEqual({
      rich_text: [{ text: { content: "abcdef0" } }],
    })
    expect(props[QA_PROPS.status]).toEqual({ select: { name: "재발" } })
  })

  it("bumpRow는 reopen이 아니면 상태를 건드리지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "page-1" }))
    const client = createQaNotionClient(ENV, fetchMock)

    await client.bumpRow("page-1", {
      count: 2,
      occurredAt: "2026-11-10T02:00:00.000Z",
      appVersion: "v",
      reopen: false,
    })

    const props = lastCall().body.properties as Record<string, unknown>
    expect(props[QA_PROPS.status]).toBeUndefined()
  })

  it("429는 한 번 재시도한다", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(json(200, { results: [] }))
    const client = createQaNotionClient(ENV, fetchMock)

    expect(await client.findByFingerprint("x")).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("429가 두 번이면 throw 없이 포기한다", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 429 }))
    const client = createQaNotionClient(ENV, fetchMock)

    await expect(client.findByFingerprint("x")).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
