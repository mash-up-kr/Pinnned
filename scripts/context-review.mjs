#!/usr/bin/env node
// 맥락 리뷰: PR diff를 팀 위키와 대조해, 위키에 근거가 있는 지적만 PR에 남긴다 (CI 전용, 의존성 없음).
//   node scripts/context-review.mjs --wiki <위키 체크아웃 경로>
// env: GEMINI_API_KEY, GH_TOKEN, REPOSITORY(owner/name), PR_NUMBER, WIKI_REPO, GEMINI_MODEL
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import {
  MARKER,
  annotateDiff,
  buildWikiText,
  findingKey,
  formatFinding,
  selectPages,
  validateFindings,
} from "./context-review/lib.mjs"

const MAX_DIFF_CHARS = 300_000
const env = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name}이 없다`)
  return value
}
const wikiDir = process.argv[process.argv.indexOf("--wiki") + 1]
const repository = env("REPOSITORY")
const prNumber = env("PR_NUMBER")
const wikiRepo = env("WIKI_REPO")
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash"
const FALLBACK_MODEL = "gemini-3.5-flash-lite"

const gh = (args, input) =>
  execFileSync("gh", args, {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const entry = join(dir, name)
    return statSync(entry).isDirectory() ? walk(entry) : [entry]
  })

const allPages = walk(join(wikiDir, "wiki"))
  .filter((file) => file.endsWith(".md"))
  .map((file) => ({
    path: relative(wikiDir, file).replaceAll("\\", "/"),
    text: readFileSync(file, "utf8"),
  }))
  // 로그는 근거가 아니다
  .filter((page) => page.path !== "wiki/log.md")

const { text: diffText, commentable } = annotateDiff(
  gh(["pr", "diff", prNumber, "--repo", repository])
)
if (!diffText) {
  console.log("리뷰할 코드 변경 없음")
  process.exit(0)
}
// 위키가 커지면 목차로 바뀐 경로에 해당하는 쪽만 고른다
const pages = selectPages(allPages, [...commentable.keys()])
console.log(`위키 ${allPages.length}쪽 중 ${pages.length}쪽 사용`)

const prompt = `너는 Pinnned 팀의 도메인 맥락을 아는 리뷰어다. 아래 "위키"는 팀이 확정한 제품 규칙, FE↔BE 계약, 결정, 아직 열린 질문이다. "변경"은 PR의 diff다.

할 일: 변경이 위키와 어긋나는 곳만 찾는다. 일반적인 코드 품질·스타일·버그 지적은 다른 리뷰어가 하므로 하지 않는다.

지적하는 경우:
1. 변경이 위키의 규칙·결정·계약과 다르게 동작한다
2. 변경이 위키의 "열린 질문"으로 남아 있는 것을 정해진 것처럼 구현한다
3. 변경이 계약(인증, 에러 코드, 지역코드, 업로드)을 건드리는데 위키의 약속을 빠뜨린다

규칙:
- 지적마다 근거가 되는 위키 쪽 경로(page), 근거 ID(ref: D-001, SPEC-04 §6, Q07 등, 없으면 빈 문자열), 그 쪽에서 **글자 그대로 복사한** 한 문장(quote)을 반드시 단다. 고쳐 쓰거나 요약한 인용은 버려진다.
- 위키에 근거가 없으면 지적하지 않는다. 추측하지 않는다. 지적할 것이 없으면 빈 배열을 낸다.
- status가 draft인 쪽은 단서다. 그 쪽을 근거로 할 때는 단정하지 말고 확인을 요청한다.
- 코드가 지금 어떻게 동작하는지는 변경이 기준이고, 어떻게 동작해야 하는지는 위키가 기준이다.
- path는 변경의 "### " 뒤 파일 경로, line은 줄 앞에 붙은 번호(새 파일 기준)다. 추가된 줄(+)에 단다.
- comment는 한국어로 2~3문장. 무엇이 어긋나는지와 어떻게 맞추면 되는지를 적는다.
- 최대 5개. 확신이 낮은 것은 내지 않는다.

# 위키

${buildWikiText(pages)}

# 변경

${diffText.slice(0, MAX_DIFF_CHARS)}`

const requestBody = JSON.stringify({
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: 0,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        findings: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              path: { type: "STRING" },
              line: { type: "INTEGER" },
              page: { type: "STRING" },
              ref: { type: "STRING" },
              quote: { type: "STRING" },
              comment: { type: "STRING" },
            },
            required: ["path", "line", "page", "quote", "comment"],
          },
        },
      },
      required: ["findings"],
    },
  },
})

// 과부하(429·5xx)는 흔하다 — 모델마다 3번까지 기다렸다 다시 부르고, 그래도 안 되면 예비 모델로 넘어간다
async function generate() {
  let lastError = ""
  for (const name of [...new Set([model, FALLBACK_MODEL])]) {
    for (const waitSeconds of [0, 10, 30]) {
      if (waitSeconds)
        await new Promise((r) => setTimeout(r, waitSeconds * 1000))
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env("GEMINI_API_KEY"),
          },
          signal: AbortSignal.timeout(180_000),
          body: requestBody,
        }
      )
      if (response.ok) {
        console.log(`모델: ${name}`)
        return response.json()
      }
      lastError = `Gemini ${name} ${response.status}: ${(await response.text()).slice(0, 300)}`
      if (response.status !== 429 && response.status < 500) break
    }
  }
  throw new Error(lastError)
}

const data = await generate()
const raw =
  data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? ""
const findings = JSON.parse(raw || '{"findings":[]}').findings
const { inline, general } = validateFindings(findings, { pages, commentable })
console.log(
  `모델 지적 ${findings.length}건 → 근거 확인 통과 ${inline.length + general.length}건 (인라인 ${inline.length})`
)

// 같은 지적을 다시 달지 않는다 (push마다 다시 돌기 때문). 인라인 댓글과 리뷰 본문 둘 다 본다
const existing = ["comments", "reviews"]
  .map((kind) =>
    gh([
      "api",
      `repos/${repository}/pulls/${prNumber}/${kind}`,
      "--paginate",
      "--jq",
      ".[].body",
    ])
  )
  .join("\n")
const isNew = (item) => !existing.includes(findingKey(item))
const fresh = inline.filter(isNew)
const freshGeneral = general.filter(isNew)
if (fresh.length === 0 && freshGeneral.length === 0) {
  console.log("새로 남길 지적 없음")
  process.exit(0)
}

const body =
  freshGeneral.length > 0
    ? freshGeneral
        .map((item) => formatFinding(item, wikiRepo))
        .join("\n\n---\n\n")
    : `${MARKER}\n**맥락 리뷰**: 위키와 어긋나는 곳 ${fresh.length}건`
gh(
  ["api", `repos/${repository}/pulls/${prNumber}/reviews`, "--input", "-"],
  JSON.stringify({
    event: "COMMENT",
    body,
    comments: fresh.map((item) => ({
      path: item.path,
      line: item.line,
      side: "RIGHT",
      body: formatFinding(item, wikiRepo),
    })),
  })
)
console.log("리뷰 등록 완료")
