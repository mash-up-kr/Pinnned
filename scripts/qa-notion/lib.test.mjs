import { describe, expect, it } from "vitest"

import {
  buildListFilter,
  createDbProperties,
  extractNotionPageIds,
  toNotionProperty,
} from "./lib.mjs"

describe("extractNotionPageIds", () => {
  it("notion.so 링크 안의 32자리 ID만 뽑는다 (커밋 SHA 등은 제외)", () => {
    const text =
      "https://www.notion.so/QA-1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6 and sha 1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c7"
    expect(extractNotionPageIds(text)).toEqual([
      "1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6",
    ])
  })

  it("하이픈 UUID 형식 링크도 32자리로 정규화한다", () => {
    expect(
      extractNotionPageIds(
        "see https://notion.so/1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6"
      )
    ).toEqual(["1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6"])
  })

  it("app.notion.com 링크와 중복을 처리한다", () => {
    const url = "https://app.notion.com/p/QA-413379ef2f0d80b6a699d280132815d0"
    expect(extractNotionPageIds(`${url}\n${url}`)).toEqual([
      "413379ef2f0d80b6a699d280132815d0",
    ])
  })
})

describe("toNotionProperty", () => {
  it("select 속성", () => {
    expect(toNotionProperty("상태", "PR있음")).toEqual({
      select: { name: "PR있음" },
    })
    expect(toNotionProperty("판정", "FE")).toEqual({ select: { name: "FE" } })
  })

  it("url 속성", () => {
    expect(toNotionProperty("PR", "https://x")).toEqual({ url: "https://x" })
    expect(toNotionProperty("FE 이슈", "https://y")).toEqual({
      url: "https://y",
    })
  })

  it("그 외는 rich_text", () => {
    expect(toNotionProperty("원인 요약", "텍스트")).toEqual({
      rich_text: [{ text: { content: "텍스트" } }],
    })
  })
})

describe("createDbProperties", () => {
  const props = createDbProperties()

  it("스펙 5.3의 속성이 전부 있다", () => {
    for (const name of [
      "제목",
      "상태",
      "출처",
      "종류",
      "심각도",
      "판정",
      "화면",
      "현상",
      "환경",
      "오류 위치",
      "발생 횟수",
      "마지막 발생",
      "지문",
      "스크린샷",
      "원인 요약",
      "FE 이슈",
      "BE 이슈",
      "PR",
    ])
      expect(props, name).toHaveProperty(name)
  })

  it("상태 select 옵션은 정확히 8개", () => {
    expect(props["상태"].select.options.map((o) => o.name)).toEqual([
      "신규",
      "분석중",
      "보류",
      "이슈생성",
      "PR있음",
      "해결",
      "재발",
      "무시",
    ])
  })

  it("제목은 title, 발생 횟수는 number, 날짜는 date, 링크는 url", () => {
    expect(props["제목"]).toEqual({ title: {} })
    expect(props["발생 횟수"]).toEqual({ number: {} })
    expect(props["마지막 발생"]).toEqual({ date: {} })
    expect(props["PR"]).toEqual({ url: {} })
    expect(props["스크린샷"]).toEqual({ files: {} })
    expect(props["종류"].select.options.map((o) => o.name)).toContain(
      "서버 요청 실패"
    )
    expect(props["심각도"].select.options.map((o) => o.name)).toEqual([
      "치명",
      "높음",
      "보통",
      "낮음",
    ])
    for (const removed of [
      "메모",
      "라우트",
      "첫 발생",
      "원인 그룹",
      "재현 방법",
      "기대 동작",
    ])
      expect(props).not.toHaveProperty(removed)
  })
})

describe("buildListFilter", () => {
  it("기간 내 마지막 발생(해결·무시 제외) 또는 상태 신규 — 노션 중첩 2단계 제한 안", () => {
    const filter = buildListFilter(
      "2026-11-03T00:00:00+09:00",
      "2026-11-10T00:00:00+09:00"
    )
    expect(filter).toEqual({
      or: [
        {
          and: [
            { property: "상태", select: { does_not_equal: "해결" } },
            { property: "상태", select: { does_not_equal: "무시" } },
            {
              property: "마지막 발생",
              date: { on_or_after: "2026-11-03T00:00:00+09:00" },
            },
            {
              property: "마지막 발생",
              date: { before: "2026-11-10T00:00:00+09:00" },
            },
          ],
        },
        { property: "상태", select: { equals: "신규" } },
      ],
    })
  })
})
