import { describe, expect, it } from "vitest"

import {
  buildListFilter,
  createDbProperties,
  extractNotionPageIds,
  flattenPage,
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
    expect(toNotionProperty("진행", "Done")).toEqual({
      select: { name: "Done" },
    })
    expect(toNotionProperty("심각도", "높음")).toEqual({
      select: { name: "높음" },
    })
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

  it("속성은 16개, 표에 보이는 8개가 전부 있다", () => {
    expect(Object.keys(props)).toHaveLength(16)
    for (const name of [
      "제목",
      "진행",
      "발생일",
      "심각도",
      "종류",
      "화면",
      "현상",
      "발생 횟수",
      "환경",
      "원인 요약",
      "FE 이슈",
      "BE 이슈",
      "PR",
      "스크린샷",
      "마지막 발생",
      "지문",
    ])
      expect(props, name).toHaveProperty(name)
  })

  it("없앤 속성은 다시 생기지 않는다", () => {
    for (const removed of [
      "상태",
      "출처",
      "판정",
      "오류 위치",
      "메모",
      "라우트",
      "첫 발생",
      "원인 그룹",
      "재현 방법",
      "기대 동작",
    ])
      expect(props).not.toHaveProperty(removed)
  })

  it("진행은 Todo(빨강)·Done(초록) 둘, 심각도 4개, 종류 라벨 포함", () => {
    expect(props["진행"].select.options).toEqual([
      { name: "Todo", color: "red" },
      { name: "Done", color: "green" },
    ])
    expect(props["심각도"].select.options.map((o) => o.name)).toEqual([
      "치명",
      "높음",
      "보통",
      "낮음",
    ])
    expect(props["종류"].select.options.map((o) => o.name)).toContain(
      "서버 요청 실패"
    )
  })

  it("타입: title / number / date / url / files", () => {
    expect(props["제목"]).toEqual({ title: {} })
    expect(props["발생 횟수"]).toEqual({ number: {} })
    expect(props["발생일"]).toEqual({ date: {} })
    expect(props["마지막 발생"]).toEqual({ date: {} })
    expect(props["PR"]).toEqual({ url: {} })
    expect(props["스크린샷"]).toEqual({ files: {} })
  })
})

describe("buildListFilter", () => {
  it("진행=Todo 이면서 (기간 내 발생 OR 분석 전), until은 배타", () => {
    const filter = buildListFilter(
      "2026-11-03T00:00:00+09:00",
      "2026-11-10T00:00:00+09:00"
    )
    expect(filter).toEqual({
      and: [
        { property: "진행", select: { equals: "Todo" } },
        {
          or: [
            {
              property: "마지막 발생",
              date: { on_or_after: "2026-11-03T00:00:00+09:00" },
            },
            { property: "원인 요약", rich_text: { is_empty: true } },
          ],
        },
        {
          property: "마지막 발생",
          date: { before: "2026-11-10T00:00:00+09:00" },
        },
      ],
    })
  })
})

describe("flattenPage", () => {
  it("지문이 없으면 수동 제보로 본다", () => {
    const base = {
      id: "aaaa-bbbb",
      url: "https://notion.so/x",
      properties: {
        제목: { title: [{ plain_text: "[지도] 서버 요청 실패" }] },
        진행: { select: { name: "Todo" } },
        "발생 횟수": { number: 2 },
        지문: { rich_text: [] },
      },
    }
    expect(flattenPage(base, "본문")).toMatchObject({
      pageId: "aaaabbbb",
      title: "[지도] 서버 요청 실패",
      progress: "Todo",
      count: 2,
      manual: true,
      bodyText: "본문",
    })
    expect(
      flattenPage({
        ...base,
        properties: {
          ...base.properties,
          지문: { rich_text: [{ plain_text: "ab" }] },
        },
      }).manual
    ).toBe(false)
  })
})
