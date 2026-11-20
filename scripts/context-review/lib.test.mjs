import { describe, expect, it } from "vitest"

import {
  annotateDiff,
  buildWikiText,
  formatFinding,
  validateFindings,
} from "./lib.mjs"

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@ export function a() {",
  " const x = 1",
  "-const y = 2",
  "+const y = 3",
  "+const z = 4",
  " return x",
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/src/a.test.ts b/src/a.test.ts",
  "--- a/src/a.test.ts",
  "+++ b/src/a.test.ts",
  "@@ -1 +1 @@",
  "+it()",
].join("\n")

const PAGES = [
  {
    path: "wiki/product/pot.md",
    text: "---\nstatus: current\n---\n- 팟 최대 인원은 6명 고정이다 (SPEC-04 §7)",
  },
  {
    path: "wiki/contract/auth.md",
    text: "---\nstatus: draft\n---\n토큰 없이 요청하면   200과 UNAUTHENTICATED를 돌려준다",
  },
  { path: "wiki/old.md", text: "---\nstatus: superseded\n---\n옛 규칙" },
]

describe("annotateDiff", () => {
  it("새 파일 기준 줄 번호를 붙이고 문서·테스트 파일은 뺀다", () => {
    const { text, commentable } = annotateDiff(DIFF)

    expect([...commentable.keys()]).toEqual(["src/a.ts"])
    expect([...commentable.get("src/a.ts")]).toEqual([10, 11, 12, 13])
    expect(text).toContain("   11 +const y = 3")
    expect(text).toContain("      -const y = 2")
    expect(text).not.toContain("README")
  })
})

describe("buildWikiText", () => {
  it("superseded 쪽은 빼고 상태를 머리에 적는다", () => {
    const text = buildWikiText(PAGES)

    expect(text).toContain("===== wiki/product/pot.md (status: current) =====")
    expect(text).not.toContain("옛 규칙")
  })
})

describe("validateFindings", () => {
  const { commentable } = annotateDiff(DIFF)
  const base = {
    path: "src/a.ts",
    line: 11,
    page: "wiki/product/pot.md",
    ref: "SPEC-04 §7",
    quote: "팟 최대 인원은 6명 고정이다",
    comment: "7명까지 허용하고 있습니다.",
  }

  it("인용이 위키에 그대로 있는 지적만 남긴다 (지어낸 근거 차단)", () => {
    const result = validateFindings(
      [
        base,
        { ...base, quote: "팟 최대 인원은 8명이다" },
        { ...base, page: "wiki/없는쪽.md" },
        { ...base, quote: "6명" },
      ],
      { pages: PAGES, commentable }
    )

    expect(result.inline).toHaveLength(1)
    expect(result.general).toHaveLength(0)
  })

  it("diff 밖 줄은 본문 지적으로 돌리고, 공백 차이는 허용하며, draft 근거는 표시한다", () => {
    const result = validateFindings(
      [
        {
          ...base,
          line: 99,
          page: "wiki/contract/auth.md",
          quote: "토큰 없이 요청하면 200과 UNAUTHENTICATED를 돌려준다",
        },
      ],
      { pages: PAGES, commentable }
    )

    expect(result.inline).toHaveLength(0)
    expect(result.general[0].draft).toBe(true)
    expect(formatFinding(result.general[0], "o/w")).toContain("아직 `draft`")
  })

  it("최대 개수를 넘기지 않는다", () => {
    const result = validateFindings(Array(9).fill(base), {
      pages: PAGES,
      commentable,
      max: 3,
    })

    expect(result.inline).toHaveLength(3)
  })
})
