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
  screen: "화면",
  severity: "심각도",
  count: "발생 횟수",
  /** 첫 발생 날짜. 생성 시 한 번만 기록 */
  firstSeen: "발생일",
  lastSeen: "마지막 발생",
  fingerprint: "지문",
  environment: "환경",
  symptom: "현상",
  location: "오류 위치",
} as const

export interface QaNotionClient {
  findByFingerprint: (
    fingerprint: string
  ) => Promise<{ pageId: string; count: number; status: string } | null>
  createRow: (input: {
    title: string
    /** 현상(실제 결과) — 사용자 관점 한 문장 */
    symptom: string
    /** 노션 `종류` 옵션 이름 (KIND_LABELS) */
    kindLabel: string
    severity: string
    /** "팟 상세 (/my-page/pot/$potId)" */
    screen?: string
    fingerprint: string
    /** "iPhone · Safari · 390x844 · v1234567" */
    environment: string
    occurredAt: string
    /** 복원된 최상위 프레임 "src/x.tsx:42" 또는 API 요청 이름 */
    location?: string
    /** 페이지 본문 블록 (row-content.ts가 만든다) */
    children: Array<unknown>
  }) => Promise<void>
  bumpRow: (
    pageId: string,
    input: {
      count: number
      occurredAt: string
      environment: string
      /** true면 상태를 "재발"로 바꾼다 (해결된 행에 다시 들어온 경우) */
      reopen: boolean
    }
  ) => Promise<void>
}

const text = (content: string) => ({
  rich_text: [{ text: { content: content.slice(0, RICH_TEXT_LIMIT) } }],
})
const select = (name: string) => ({ select: { name } })
/**
 * 한국 시간으로 표시되는 날짜. 노션은 time_zone을 주면 start에 오프셋을 붙이지 못하므로
 * KST 로컬 시각 문자열("2026-11-10T22:25:00")로 바꿔 넣는다.
 */
const date = (iso: string) => ({
  date: {
    start: new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19),
    time_zone: "Asia/Seoul",
  },
})

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
        [QA_PROPS.kind]: select(input.kindLabel),
        [QA_PROPS.severity]: select(input.severity),
        [QA_PROPS.count]: { number: 1 },
        [QA_PROPS.firstSeen]: date(input.occurredAt),
        [QA_PROPS.lastSeen]: date(input.occurredAt),
        [QA_PROPS.fingerprint]: text(input.fingerprint),
        [QA_PROPS.environment]: text(input.environment),
        [QA_PROPS.symptom]: text(input.symptom),
      }
      if (input.screen) properties[QA_PROPS.screen] = text(input.screen)
      if (input.location) properties[QA_PROPS.location] = text(input.location)

      await call("POST", "/pages", {
        parent: { database_id: env.databaseId },
        properties,
        children: input.children,
      })
    },

    async bumpRow(pageId, input) {
      const properties: Record<string, unknown> = {
        [QA_PROPS.count]: { number: input.count },
        [QA_PROPS.lastSeen]: date(input.occurredAt),
        [QA_PROPS.environment]: text(input.environment),
      }
      if (input.reopen) properties[QA_PROPS.status] = select("재발")
      await call("PATCH", `/pages/${pageId}`, { properties })
    },
  }
}
