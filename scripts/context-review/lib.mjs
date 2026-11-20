// 맥락 리뷰 공용 함수 (CI 스크립트 전용, 의존성 없음).
// 위키(inhachoi/pinnned-llm-wiki)에 근거가 있는 지적만 PR에 남기기 위한 파싱·검증.

/** 리뷰 대상에서 빼는 파일: 문서·설정·잠금 파일·테스트·스토리 */
const SKIPPED_FILE =
  /\.(md|json|ya?ml|lock|snap|svg|png|jpe?g|webp)$|\.(test|spec|stories)\.[jt]sx?$|(^|\/)pnpm-lock\.yaml$/

/**
 * unified diff에 새 파일 기준 줄 번호를 붙인다. 모델이 줄 번호를 세지 않고 읽게 하려는 것.
 * commentable: 파일별로 인라인 댓글을 달 수 있는 줄(헝크 안의 추가·유지 줄).
 */
export function annotateDiff(diff) {
  const out = []
  const commentable = new Map()
  let path = null
  let line = 0
  let inHunk = false

  for (const raw of diff.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.startsWith("diff --git ")) {
      path = null
      inHunk = false
      continue
    }
    if (raw.startsWith("+++ ")) {
      const next = raw.slice(4).replace(/^b\//, "")
      path = next === "/dev/null" || SKIPPED_FILE.test(next) ? null : next
      if (path) {
        commentable.set(path, new Set())
        out.push(`\n### ${path}`)
      }
      continue
    }
    if (!path) continue
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      line = Number(hunk[1])
      inHunk = true
      out.push(raw)
      continue
    }
    if (!inHunk || raw.startsWith("\\")) continue
    if (raw.startsWith("-")) {
      out.push(`      ${raw}`)
      continue
    }
    commentable.get(path).add(line)
    out.push(`${String(line).padStart(5)} ${raw}`)
    line += 1
  }
  return { text: out.join("\n").trim(), commentable }
}

const statusOf = (text) => text.match(/^status:\s*(\w+)/m)?.[1] ?? "draft"

/** 위키 쪽들을 한 덩어리 프롬프트 텍스트로. superseded 쪽은 근거가 될 수 없으니 뺀다. */
export function buildWikiText(pages) {
  return pages
    .filter((page) => statusOf(page.text) !== "superseded")
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(
      (page) =>
        `===== ${page.path} (status: ${statusOf(page.text)}) =====\n${page.text.trim()}`
    )
    .join("\n\n")
}

const squash = (text) => text.replace(/\s+/g, " ").trim()

/**
 * 모델이 낸 지적 중 위키에 실제 근거가 있는 것만 남긴다. 지어낸 근거를 걸러내는 관문이다.
 * - page가 위키에 있는 쪽이어야 한다
 * - quote가 그 쪽 본문에 그대로 있어야 한다 (공백 차이만 허용, 8자 이상)
 * - 줄이 diff 안이면 인라인, 아니면 본문 지적으로 돌린다
 */
export function validateFindings(findings, { pages, commentable, max = 5 }) {
  const byPath = new Map(pages.map((page) => [page.path, page.text]))
  const inline = []
  const general = []

  for (const finding of Array.isArray(findings) ? findings : []) {
    if (inline.length + general.length >= max) break
    const pageText = byPath.get(finding?.page)
    const quote = squash(String(finding?.quote ?? ""))
    const comment = String(finding?.comment ?? "").trim()
    if (!pageText || quote.length < 8 || !comment) continue
    if (!squash(pageText).includes(quote)) continue

    const item = {
      path: String(finding.path ?? ""),
      line: Number(finding.line),
      page: finding.page,
      ref: String(finding.ref ?? "").trim(),
      quote,
      comment,
      draft: statusOf(pageText) !== "current",
    }
    if (commentable.get(item.path)?.has(item.line)) inline.push(item)
    else general.push(item)
  }
  return { inline, general }
}

export const MARKER = "<!-- context-review -->"

/** push마다 다시 돌아도 같은 지적을 또 달지 않기 위한 키. 줄 번호는 push로 밀리므로 넣지 않는다. */
export const findingKey = (item) =>
  `<!-- context-review-key ${item.page} ${item.ref} ${item.path} -->`

/** 댓글 본문: 근거 쪽·ID·인용을 먼저 보여 지적이 어디서 왔는지 확인할 수 있게 한다. */
export function formatFinding(item, wikiRepo) {
  const link = `https://github.com/${wikiRepo}/blob/main/${item.page}`
  const ref = item.ref ? ` · ${item.ref}` : ""
  const caution = item.draft
    ? "\n\n_이 근거 쪽은 아직 `draft`입니다. 출처를 확인해 주세요._"
    : ""
  return `${MARKER}\n${findingKey(item)}\n**맥락 리뷰** · [\`${item.page}\`](${link})${ref}\n> ${item.quote}\n\n${item.comment}${caution}`
}

const ALWAYS = /^wiki\/(decisions|open-questions|glossary)\.md$/

/**
 * 위키가 예산을 넘게 커지면 목차 트리로 읽을 쪽을 고른다. 예산 안이면 전부 넘긴다.
 * 목차 표의 각 줄에서 쪽 링크와 백틱 경로(`pages/pot-join` 등)를 읽어, 바뀐 파일 경로와 맞는 쪽만 남긴다.
 * 결정·열린 질문·용어집과 목차 자신은 항상 포함한다.
 */
export function selectPages(pages, changedPaths, budgetChars = 400_000) {
  const total = pages.reduce((sum, page) => sum + page.text.length, 0)
  if (total <= budgetChars) return pages

  const matched = new Set()
  for (const index of pages.filter((p) => p.path.endsWith("/index.md"))) {
    const dir = index.path.slice(0, index.path.lastIndexOf("/"))
    for (const row of index.text.split("\n")) {
      const link = row.match(/\]\(([^)\s]+\.md)\)/)?.[1]
      if (!link || link.startsWith("..")) continue
      const tokens = [...row.matchAll(/`([^`]+)`/g)].map((m) => m[1])
      if (
        tokens.some((token) =>
          changedPaths.some((changed) => changed.includes(token))
        )
      )
        matched.add(`${dir}/${link}`)
    }
  }
  return pages.filter(
    (page) =>
      ALWAYS.test(page.path) ||
      page.path.endsWith("/index.md") ||
      matched.has(page.path) ||
      // 하위 목차가 맞으면 그 폴더의 쪽도 포함한다
      [...matched].some(
        (m) => m.endsWith("/index.md") && page.path.startsWith(m.slice(0, -8))
      )
  )
}
