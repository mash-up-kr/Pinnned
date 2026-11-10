// 노션 QA DB용 공용 함수 (CI 스크립트 전용, 의존성 없음).
// 속성 이름은 src/shared/server/qa-notion.ts의 QA_PROPS와 같아야 한다.

export const NOTION_API = "https://api.notion.com/v1"
export const NOTION_VERSION = "2022-06-28"
const RICH_TEXT_LIMIT = 2000

export const STATUS_OPTIONS = [
  "신규",
  "분석중",
  "보류",
  "이슈생성",
  "PR있음",
  "해결",
  "재발",
  "무시",
]
/** 표 맨 왼쪽 뱃지. 상태에서 파생: 해결·무시 → Done, 그 외 → Todo */
export const PROGRESS_OPTIONS = [
  { name: "Todo", color: "red" },
  { name: "Done", color: "green" },
]
export function progressFor(status) {
  return status === "해결" || status === "무시" ? "Done" : "Todo"
}

const SELECT_PROPS = {
  상태: STATUS_OPTIONS,
  진행: PROGRESS_OPTIONS.map((o) => o.name),
  출처: ["자동수집", "수동제보"],
  // src/shared/server/row-content.ts의 KIND_LABELS와 같아야 한다
  종류: [
    "동작 오류",
    "비동기 오류",
    "화면 표시 오류",
    "페이지 로드 실패",
    "서버 요청 실패",
    "기타",
  ],
  심각도: ["치명", "높음", "보통", "낮음"],
  판정: ["FE", "BE", "FE+BE", "보류", "노이즈"],
}
const URL_PROPS = new Set(["FE 이슈", "BE 이슈", "PR"])
const TEXT_PROPS = ["화면", "현상", "환경", "오류 위치", "지문", "원인 요약"]

/** 스펙 5.3 그대로. `create-db`가 이걸로 DB를 만든다. */
export function createDbProperties() {
  const props = { 제목: { title: {} } }
  for (const [name, options] of Object.entries(SELECT_PROPS))
    props[name] = { select: { options: options.map((o) => ({ name: o })) } }
  props["진행"] = { select: { options: PROGRESS_OPTIONS } }
  for (const name of TEXT_PROPS) props[name] = { rich_text: {} }
  for (const name of URL_PROPS) props[name] = { url: {} }
  props["발생 횟수"] = { number: {} }
  props["스크린샷"] = { files: {} }
  props["발생일"] = { date: {} }
  props["마지막 발생"] = { date: {} }
  return props
}

/** `update --json`의 값을 속성 타입에 맞게 감싼다. */
export function toNotionProperty(name, value) {
  if (name in SELECT_PROPS) return { select: { name: value } }
  if (URL_PROPS.has(name)) return { url: value }
  return {
    rich_text: [{ text: { content: String(value).slice(0, RICH_TEXT_LIMIT) } }],
  }
}

/**
 * 주간 대상: (기간 내 마지막 발생 AND 해결·무시 아님) OR 상태=신규(수동 제보·미처리분).
 * until은 배타(다음 주 월요일 00:00). 노션 필터는 중첩 2단계까지라 or→and→leaf로 편다.
 */
export function buildListFilter(since, until) {
  return {
    or: [
      {
        and: [
          { property: "상태", select: { does_not_equal: "해결" } },
          { property: "상태", select: { does_not_equal: "무시" } },
          { property: "마지막 발생", date: { on_or_after: since } },
          { property: "마지막 발생", date: { before: until } },
        ],
      },
      { property: "상태", select: { equals: "신규" } },
    ],
  }
}

/** PR 본문에서 노션 링크 안의 페이지 ID만 뽑는다 (커밋 SHA 같은 32자리 hex는 제외). 하이픈 UUID도 정규화. */
export function extractNotionPageIds(text) {
  const pattern =
    /notion\.(?:so|com)\/[^\s)"'<>]*?([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/gi
  const ids = new Set()
  for (const match of text.matchAll(pattern))
    ids.add(match[1].replaceAll("-", "").toLowerCase())
  return [...ids]
}

const plain = (rich) => (rich ?? []).map((r) => r.plain_text ?? "").join("")

/** 노션 페이지 객체 → 주간 분석이 읽기 쉬운 평면 객체 */
export function flattenPage(page, stackFromBody = "") {
  const p = page.properties
  const text = (name) => plain(p[name]?.rich_text)
  const select = (name) => p[name]?.select?.name ?? ""
  const date = (name) => p[name]?.date?.start ?? ""
  return {
    pageId: page.id.replaceAll("-", ""),
    url: page.url,
    title: plain(p["제목"]?.title),
    symptom: text("현상"),
    location: text("오류 위치"),
    status: select("상태"),
    severity: select("심각도"),
    source: select("출처"),
    kind: select("종류"),
    verdict: select("판정"),
    screen: text("화면"),
    count: p["발생 횟수"]?.number ?? 0,
    fingerprint: text("지문"),
    environment: text("환경"),
    firstSeen: date("발생일"),
    lastSeen: date("마지막 발생"),
    // 스택·API·환경은 페이지 본문 "개발자용 기술 정보" 토글 안 코드 블록에 있다
    stackText: stackFromBody,
    causeSummary: text("원인 요약"),
    feIssue: p["FE 이슈"]?.url ?? "",
    beIssue: p["BE 이슈"]?.url ?? "",
    pr: p["PR"]?.url ?? "",
    manual: select("출처") === "수동제보",
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 노션 API 호출. 3rps 한도 보호로 호출 사이 350ms, 429는 Retry-After 뒤 1회 재시도. */
export function createNotionApi(token, fetchImpl = fetch) {
  let last = 0
  async function call(method, path, body) {
    const wait = 350 - (Date.now() - last)
    if (wait > 0) await sleep(wait)
    for (let attempt = 0; attempt < 2; attempt++) {
      last = Date.now()
      const res = await fetchImpl(`${NOTION_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (res.status === 429 && attempt === 0) {
        await sleep(Number(res.headers.get("retry-after") ?? 1) * 1000)
        continue
      }
      if (!res.ok)
        throw new Error(
          `Notion ${method} ${path} → ${res.status} ${await res.text()}`
        )
      return res.json()
    }
    throw new Error(`Notion ${method} ${path} → 429 (재시도 실패)`)
  }
  return { call }
}
