import { describe, expect, it } from "vitest"

import {
  KIND_LABELS,
  buildEnvironment,
  buildExpected,
  buildReproSteps,
  buildRowBlocks,
  buildRowTitle,
  buildSymptom,
  describeDevice,
  humanizeMessage,
  screenName,
  severityOf,
} from "./row-content"
import type { ErrorReport } from "@/shared/api/error-reporter"

const BASE: ErrorReport = {
  kind: "js-error",
  name: "TypeError",
  message: "Cannot read properties of undefined (reading 'id')",
  stack: "TypeError: x\n    at src/features/pot/ui/PotDetail.tsx:42:9",
  routePattern: "/my-page/pot/$potId",
  breadcrumbs: ["/", "/my-page", "/my-page/pot/$potId"],
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  viewport: "390x844",
  online: true,
  authenticated: true,
  appVersion: "1234567",
  occurredAt: "2026-11-10T09:00:00.000Z",
}

const API: ErrorReport = {
  ...BASE,
  kind: "api-failure",
  name: undefined,
  stack: undefined,
  message: "MyPots 500",
  routePattern: "/map-google",
  breadcrumbs: ["/", "/map-google"],
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
  api: { protocol: "graphql", name: "MyPots", status: 500 },
}

describe("screenName", () => {
  it("라우트 패턴을 화면 이름으로, 모르는 경로는 그대로", () => {
    expect(screenName("/my-page/pot/$potId")).toBe("팟 상세")
    expect(screenName("/map-google")).toBe("지도")
    expect(screenName("/unknown")).toBe("/unknown")
    expect(screenName(undefined)).toBe("알 수 없음")
  })
})

describe("humanizeMessage", () => {
  it("흔한 JS 에러를 한글로 풀어쓴다", () => {
    expect(
      humanizeMessage("Cannot read properties of undefined (reading 'id')")
    ).toBe("'id' 값을 읽으려 했지만 데이터가 비어 있음")
    expect(humanizeMessage("foo is not a function")).toBe(
      "'foo'이(가) 함수가 아님"
    )
    expect(humanizeMessage("Failed to fetch")).toBe("네트워크 연결 실패")
  })

  it("모르는 메시지는 80자로 잘라 그대로", () => {
    expect(humanizeMessage("x".repeat(100))).toHaveLength(80)
  })
})

describe("buildRowTitle — [화면] 증상", () => {
  it("API 실패", () => {
    expect(buildRowTitle(API)).toBe("[지도] 서버 요청 실패 (MyPots 500)")
  })

  it("JS 에러", () => {
    expect(buildRowTitle(BASE)).toBe(
      "[팟 상세] 동작 오류 – 'id' 값을 읽으려 했지만 데이터가 비어 있음"
    )
  })

  it("렌더·SSR", () => {
    expect(buildRowTitle({ ...BASE, kind: "render-error" })).toMatch(
      /^\[팟 상세\] 화면 표시 오류 – /
    )
    expect(
      buildRowTitle({ ...BASE, kind: "ssr-error", routePattern: "/signup" })
    ).toMatch(/^\[회원가입\] 페이지 로드 실패 – /)
  })
})

describe("severityOf", () => {
  it("페이지가 안 열리거나 깨지면 높음, 5xx도 높음, 그 외 보통", () => {
    expect(severityOf({ ...BASE, kind: "ssr-error" })).toBe("높음")
    expect(severityOf({ ...BASE, kind: "render-error" })).toBe("높음")
    expect(severityOf(API)).toBe("높음")
    expect(
      severityOf({
        ...API,
        api: { protocol: "graphql", name: "MyPots", status: 200, code: "X" },
      })
    ).toBe("보통")
    expect(severityOf(BASE)).toBe("보통")
  })
})

describe("KIND_LABELS", () => {
  it("코드 → 한글 라벨", () => {
    expect(KIND_LABELS["api-failure"]).toBe("서버 요청 실패")
    expect(KIND_LABELS["js-error"]).toBe("동작 오류")
    expect(KIND_LABELS["render-error"]).toBe("화면 표시 오류")
  })
})

describe("buildSymptom / buildExpected", () => {
  it("현상은 사용자 관점 한 문장, 기대 결과는 종류별 정답", () => {
    expect(buildSymptom(API)).toBe(
      "지도 화면에서 서버 요청(MyPots)이 500 오류로 실패해 데이터가 표시되지 않거나 동작이 완료되지 않음"
    )
    expect(buildSymptom({ ...BASE, kind: "render-error" })).toBe(
      "팟 상세 화면이 정상 표시되지 않고 '문제가 발생했어요' 화면이 뜸"
    )
    expect(buildExpected(API)).toBe("요청이 정상 처리되어 데이터가 표시된다")
    expect(buildExpected(BASE)).toBe("오류 없이 동작이 완료된다")
  })
})

describe("buildReproSteps", () => {
  it("이동 경로를 번호 절차로, 자동 수집임을 표시", () => {
    expect(buildReproSteps(BASE)).toEqual([
      "랜딩 화면 진입",
      "마이페이지 화면으로 이동",
      "팟 상세 화면으로 이동",
      "오류 발생 (자동 수집 — 정확한 조작은 재현 확인 필요)",
    ])
    expect(buildReproSteps({ ...BASE, breadcrumbs: [] })).toEqual([
      "팟 상세 화면 진입",
      "오류 발생 (자동 수집 — 정확한 조작은 재현 확인 필요)",
    ])
  })
})

describe("describeDevice / buildEnvironment", () => {
  it("UA를 기기·브라우저로, 환경은 한 줄", () => {
    expect(describeDevice(BASE.userAgent)).toBe("iPhone · Safari")
    expect(describeDevice(API.userAgent)).toBe("Android · Chrome")
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
      )
    ).toBe("Windows PC · Chrome")
    expect(describeDevice("curl/8.0")).toBe("기타 · 기타")
    expect(buildEnvironment(BASE)).toBe("iPhone · Safari · 390x844 · v1234567")
  })
})

describe("buildRowBlocks — QA 리포트 본문", () => {
  const blocks = buildRowBlocks(BASE, {
    text: "TypeError: x\n    at src/features/pot/ui/PotDetail.tsx:42:9",
    resolved: true,
  })
  const headings = blocks
    .filter((b) => b.type === "heading_2")
    .map((b) => b.heading_2?.rich_text[0].text.content)

  it("현상 콜아웃 → 재현 절차 → 기대 결과 → 발생 환경 → 첨부 → 개발자 참고", () => {
    expect(blocks[0]?.type).toBe("callout")
    expect(headings).toEqual([
      "재현 절차",
      "기대 결과",
      "발생 환경",
      "첨부",
      "개발자 참고",
    ])
    expect(blocks.at(-1)?.type).toBe("toggle")
  })

  it("재현 절차는 번호 목록이다", () => {
    const steps = blocks
      .filter((b) => b.type === "numbered_list_item")
      .map((b) => b.numbered_list_item?.rich_text[0].text.content)
    expect(steps[0]).toBe("랜딩 화면 진입")
    expect(steps.at(-1)).toContain("오류 발생")
  })

  it("발생 환경은 두 줄: 기기·버전 / 로그인·네트워크·시각", () => {
    const bullets = blocks
      .filter((b) => b.type === "bulleted_list_item")
      .map((b) => b.bulleted_list_item?.rich_text[0].text.content ?? "")
    expect(bullets).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "기기: iPhone · Safari (390x844) · 앱 버전: 1234567"
        ),
        expect.stringMatching(
          /로그인: 됨 · 네트워크: 온라인 · 최초 발생: .+KST/
        ),
      ])
    )
  })

  it("개발자 참고 토글 안에 스택 코드 블록이 있고 복원 실패를 표시한다", () => {
    const toggle = blocks.at(-1)
    const code = toggle?.toggle?.children.find((c) => c.type === "code")
    expect(code?.code?.rich_text.map((r) => r.text.content).join("")).toContain(
      "PotDetail.tsx:42:9"
    )

    const unresolved = buildRowBlocks(BASE, { text: "raw", resolved: false })
    expect(JSON.stringify(unresolved.at(-1))).toContain("소스맵 복원 실패")
  })

  it("개발자 참고에 Clarity 녹화 검색 태그를 적는다", () => {
    expect(JSON.stringify(blocks.at(-1))).toContain(
      "Clarity 녹화: 사용자 지정 태그 error = js-error: Cannot read properties of undefined (reading 'id')"
    )
  })

  it("API 실패는 요청 정보를 개발자 참고에 적는다", () => {
    const apiBlocks = buildRowBlocks(API, { text: "", resolved: false })
    expect(JSON.stringify(apiBlocks.at(-1))).toContain(
      "graphql MyPots status=500"
    )
  })
})
