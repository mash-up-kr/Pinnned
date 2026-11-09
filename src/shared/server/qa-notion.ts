// 노션 QA DB 기록 — 서버 전용(토큰). 의존성 없이 REST API를 직접 호출한다.
// 속성 이름은 scripts/qa-notion/lib.mjs의 createDbProperties와 같아야 한다.

const NOTION_API = "https://api.notion.com/v1"
const NOTION_VERSION = "2022-06-28"
/** 노션 rich_text 한 조각의 최대 길이 */
const RICH_TEXT_LIMIT = 2000

export const QA_PROPS = {
  title: "제목",
  status: "상태",
  source: "출처",
  kind: "종류",
  route: "라우트",
  count: "발생 횟수",
  firstSeen: "첫 발생",
  lastSeen: "마지막 발생",
  fingerprint: "지문",
  appVersion: "앱 버전",
  stack: "복원 스택",
} as const

export interface QaNotionClient {
  findByFingerprint: (
    fingerprint: string
  ) => Promise<{ pageId: string; count: number; status: string } | null>
  createRow: (input: {
    title: string
    kind: string
    route?: string
    fingerprint: string
    appVersion: string
    occurredAt: string
    stackText: string
  }) => Promise<void>
  bumpRow: (
    pageId: string,
    input: {
      count: number
      occurredAt: string
      appVersion: string
      /** true면 상태를 "재발"로 바꾼다 (해결된 행에 다시 들어온 경우) */
      reopen: boolean
    }
  ) => Promise<void>
}

const text = (content: string) => ({
  rich_text: [{ text: { content: content.slice(0, RICH_TEXT_LIMIT) } }],
})
const select = (name: string) => ({ select: { name } })
const date = (start: string) => ({ date: { start } })

function chunk(content: string): Array<{ text: { content: string } }> {
  const parts: Array<{ text: { content: string } }> = []
  for (let i = 0; i < content.length; i += RICH_TEXT_LIMIT)
    parts.push({ text: { content: content.slice(i, i + RICH_TEXT_LIMIT) } })
  return parts
}

interface QueryResult {
  results: Array<{
    id: string
    properties: Partial<
      Record<
        string,
        { number?: number | null; select?: { name: string } | null }
      >
    >
  }>
}

export function createQaNotionClient(
  env: { token: string; databaseId: string },
  fetchImpl: typeof fetch = fetch
): QaNotionClient {
  /** 429는 한 번만 재시도하고, 그래도 실패하면 null — 기록 실패가 앱 응답을 막으면 안 된다. */
  async function call<T>(
    method: "POST" | "PATCH",
    path: string,
    body: unknown
  ): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchImpl(`${NOTION_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${env.token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
      if (res.status === 429) continue
      if (!res.ok) return null
      return (await res.json()) as T
    }
    return null
  }

  return {
    async findByFingerprint(fingerprint) {
      const data = await call<QueryResult>(
        "POST",
        `/databases/${env.databaseId}/query`,
        {
          filter: {
            property: QA_PROPS.fingerprint,
            rich_text: { equals: fingerprint },
          },
          page_size: 1,
        }
      )
      const page = data?.results[0]
      if (!page) return null
      return {
        pageId: page.id,
        count: page.properties[QA_PROPS.count]?.number ?? 0,
        status: page.properties[QA_PROPS.status]?.select?.name ?? "",
      }
    },

    async createRow(input) {
      const properties: Record<string, unknown> = {
        [QA_PROPS.title]: { title: [{ text: { content: input.title } }] },
        [QA_PROPS.status]: select("신규"),
        [QA_PROPS.source]: select("자동수집"),
        [QA_PROPS.kind]: select(input.kind),
        [QA_PROPS.count]: { number: 1 },
        [QA_PROPS.firstSeen]: date(input.occurredAt),
        [QA_PROPS.lastSeen]: date(input.occurredAt),
        [QA_PROPS.fingerprint]: text(input.fingerprint),
        [QA_PROPS.appVersion]: text(input.appVersion),
        [QA_PROPS.stack]: text(input.stackText),
      }
      if (input.route) properties[QA_PROPS.route] = text(input.route)

      const body: Record<string, unknown> = {
        parent: { database_id: env.databaseId },
        properties,
      }
      // 속성은 2,000자까지만 — 긴 스택은 페이지 본문 코드 블록에 전체를 둔다
      if (input.stackText.length > RICH_TEXT_LIMIT) {
        body.children = [
          {
            object: "block",
            type: "code",
            code: { language: "plain text", rich_text: chunk(input.stackText) },
          },
        ]
      }
      await call("POST", "/pages", body)
    },

    async bumpRow(pageId, input) {
      const properties: Record<string, unknown> = {
        [QA_PROPS.count]: { number: input.count },
        [QA_PROPS.lastSeen]: date(input.occurredAt),
        [QA_PROPS.appVersion]: text(input.appVersion),
      }
      if (input.reopen) properties[QA_PROPS.status] = select("재발")
      await call("PATCH", `/pages/${pageId}`, { properties })
    },
  }
}
