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
const SELECT_PROPS = {
  상태: STATUS_OPTIONS,
  출처: ["자동수집", "수동제보"],
  종류: [
    "js-error",
    "promise-rejection",
    "render-error",
    "ssr-error",
    "api-failure",
    "기타",
  ],
  판정: ["FE", "BE", "FE+BE", "보류", "노이즈"],
}
const URL_PROPS = new Set(["FE 이슈", "BE 이슈", "PR"])
const TEXT_PROPS = [
  "라우트",
  "지문",
  "앱 버전",
  "복원 스택",
  "원인 그룹",
  "원인 요약",
  "재현 방법",
  "기대 동작",
  "메모",
]

/** 스펙 5.3 그대로. `create-db`가 이걸로 DB를 만든다. */
export function createDbProperties() {
  const props = { 제목: { title: {} } }
  for (const [name, options] of Object.entries(SELECT_PROPS))
    props[name] = { select: { options: options.map((o) => ({ name: o })) } }
  for (const name of TEXT_PROPS) props[name] = { rich_text: {} }
  for (const name of URL_PROPS) props[name] = { url: {} }
  props["발생 횟수"] = { number: {} }
  props["첫 발생"] = { date: {} }
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
 * 주간 대상: 기간 내 마지막 발생 OR 상태=신규(수동 제보·미처리분). 해결·무시는 제외.
 * until은 배타(다음 주 월요일 00:00).
 */
export function buildListFilter(since, until) {
  return {
    and: [
      { property: "상태", select: { does_not_equal: "해결" } },
      { property: "상태", select: { does_not_equal: "무시" } },
      {
        or: [
          {
            and: [
              { property: "마지막 발생", date: { on_or_after: since } },
              { property: "마지막 발생", date: { before: until } },
            ],
          },
          { property: "상태", select: { equals: "신규" } },
        ],
      },
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
  const stackProp = text("복원 스택")
  return {
    pageId: page.id.replaceAll("-", ""),
    url: page.url,
    title: plain(p["제목"]?.title),
    status: select("상태"),
    source: select("출처"),
    kind: select("종류"),
    verdict: select("판정"),
    route: text("라우트"),
    count: p["발생 횟수"]?.number ?? 0,
    fingerprint: text("지문"),
    appVersion: text("앱 버전"),
    firstSeen: date("첫 발생"),
    lastSeen: date("마지막 발생"),
    // 2,000자 넘는 스택은 본문 코드 블록에 전체가 있다
    stackText: stackFromBody || stackProp,
    causeGroup: text("원인 그룹"),
    causeSummary: text("원인 요약"),
    feIssue: p["FE 이슈"]?.url ?? "",
    beIssue: p["BE 이슈"]?.url ?? "",
    pr: p["PR"]?.url ?? "",
    manual: select("출처") === "수동제보",
    repro: text("재현 방법"),
    expected: text("기대 동작"),
    memo: text("메모"),
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
        throw new Error(`Notion ${method} ${path} → ${res.status} ${await res.text()}`)
      return res.json()
    }
    throw new Error(`Notion ${method} ${path} → 429 (재시도 실패)`)
  }
  return { call }
}
