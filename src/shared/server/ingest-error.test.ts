import { describe, expect, it, vi } from "vitest"

import {
  ingestErrorReport,
  ingestServerError,
  parseErrorReport,
} from "./ingest-error"
import type { ErrorReport } from "@/shared/api/error-reporter"
import type { QaNotionClient } from "./qa-notion"

const REPORT: ErrorReport = {
  kind: "js-error",
  name: "TypeError",
  message: "boom",
  stack:
    "TypeError: boom\n    at https://www.pinnned.co.kr/assets/sample-abc.js:1:68",
  routePattern: "/signup",
  breadcrumbs: ["/", "/signup"],
  userAgent: "UA",
  viewport: "390x844",
  online: true,
  authenticated: false,
  appVersion: "1234567",
  occurredAt: "2026-11-10T00:00:00.000Z",
}

function notionMock(
  existing: Awaited<ReturnType<QaNotionClient["findByFingerprint"]>>
) {
  return {
    findByFingerprint: vi.fn<QaNotionClient["findByFingerprint"]>(() =>
      Promise.resolve(existing)
    ),
    createRow: vi.fn<QaNotionClient["createRow"]>(() => Promise.resolve()),
    bumpRow: vi.fn<QaNotionClient["bumpRow"]>(() => Promise.resolve()),
  }
}

const noMap = () => Promise.resolve(null)

describe("ingestErrorReport", () => {
  it("새 지문이면 QA 리포트 형식의 행을 만든다", async () => {
    const notion = notionMock(null)

    await ingestErrorReport(REPORT, { notion, fetchMap: noMap })

    expect(notion.createRow).toHaveBeenCalledTimes(1)
    expect(notion.bumpRow).not.toHaveBeenCalled()
    const input = notion.createRow.mock.calls[0][0]
    expect(input.title).toBe("[회원가입] 동작 오류 – boom")
    expect(input.symptom).toContain("회원가입 화면에서")
    expect(input.kindLabel).toBe("동작 오류")
    expect(input.severity).toBe("보통")
    expect(input.screen).toBe("회원가입 (/signup)")
    expect(input.environment).toBe("기타 · 기타 · 390x844 · v1234567")
    expect(input.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(input.location).toBe("assets/sample-abc.js:1:68")
    const body = JSON.stringify(input.children)
    expect(body).toContain("sample-abc.js:1:68")
    expect(body).toContain("랜딩 화면 진입")
    expect(body).toContain("회원가입 화면으로 이동")
    expect(body).toContain("390x844")
  })

  it("기존 행이면 횟수를 올린다", async () => {
    const notion = notionMock({ pageId: "p", count: 3, status: "신규" })

    await ingestErrorReport(REPORT, { notion, fetchMap: noMap })

    expect(notion.createRow).not.toHaveBeenCalled()
    expect(notion.bumpRow).toHaveBeenCalledWith("p", {
      count: 4,
      occurredAt: REPORT.occurredAt,
      environment: "기타 · 기타 · 390x844 · v1234567",
      reopen: false,
    })
  })

  it("해결된 행에 다시 들어오면 재발로 표시한다", async () => {
    const notion = notionMock({ pageId: "p", count: 9, status: "해결" })

    await ingestErrorReport(REPORT, { notion, fetchMap: noMap })

    expect(notion.bumpRow.mock.calls[0][1].reopen).toBe(true)
  })

  it("소스맵 조회가 실패해도 원본 스택으로 기록한다", async () => {
    const notion = notionMock(null)

    await ingestErrorReport(REPORT, {
      notion,
      fetchMap: () => Promise.reject(new Error("down")),
    })

    const input = notion.createRow.mock.calls[0][0]
    const body = JSON.stringify(input.children)
    expect(body).toContain("소스맵 복원 실패")
    expect(body).toContain("sample-abc.js:1:68")
  })
})

describe("ingestServerError", () => {
  it("노션 env가 없으면 아무 요청 없이 조용히 끝난다", async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchSpy)
    vi.stubEnv("NOTION_TOKEN", "")
    vi.stubEnv("NOTION_QA_DB_ID", "")

    await expect(
      ingestServerError(
        new Request("https://www.pinnned.co.kr/signup"),
        new Error("ssr boom")
      )
    ).resolves.toBeUndefined()

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("동적 세그먼트를 라우트 패턴·화면 이름으로 바꿔 기록한다", async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)
    vi.stubEnv("NOTION_TOKEN", "ntn_x")
    vi.stubEnv("NOTION_QA_DB_ID", "db")

    await ingestServerError(
      new Request("https://www.pinnned.co.kr/i/AB12cd"),
      new Error("ssr boom")
    )

    const createBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string)
    expect(createBody.properties["화면"]).toEqual({
      rich_text: [{ text: { content: "초대 링크 (/i/$code)" } }],
    })
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})

describe("parseErrorReport", () => {
  it("정상 페이로드는 그대로 돌려준다", () => {
    expect(parseErrorReport(REPORT)).toEqual(REPORT)
  })

  it("kind가 화이트리스트 밖이면 null", () => {
    expect(parseErrorReport({ ...REPORT, kind: "hack" })).toBeNull()
  })

  it("message가 없으면 null", () => {
    const { message: _omit, ...rest } = REPORT
    expect(parseErrorReport(rest)).toBeNull()
  })

  it("객체가 아니면 null", () => {
    expect(parseErrorReport("x")).toBeNull()
    expect(parseErrorReport(null)).toBeNull()
  })

  it("스택은 16KB로 자른다", () => {
    const parsed = parseErrorReport({ ...REPORT, stack: "s".repeat(20_000) })
    expect(parsed?.stack).toHaveLength(16_000)
  })
})
