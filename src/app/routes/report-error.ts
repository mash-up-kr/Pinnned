import { createFileRoute } from "@tanstack/react-router"

import {
  ingestErrorReport,
  parseErrorReport,
} from "@/shared/server/ingest-error"
import { createQaNotionClient } from "@/shared/server/qa-notion"
import { createRateLimiter } from "@/shared/server/rate-limit"
import { createMapFetcher } from "@/shared/server/stack-resolver"

const ALLOWED_ORIGIN = "https://www.pinnned.co.kr"
const MAX_BODY_BYTES = 32 * 1024
const NO_CONTENT = () => new Response(null, { status: 204 })
/** 인스턴스당 분당 60건. 정상 트래픽은 세션당 20건 상한이라 이 아래에 머문다 */
const allowReport = createRateLimiter(60, 60_000)

// 함수 인스턴스가 살아 있는 동안 .map 캐시를 재사용한다 (Vercel Fluid Compute)
let mapFetcher: {
  origin: string
  fetchMap: ReturnType<typeof createMapFetcher>
} | null = null
let warnedMissingEnv = false

/**
 * 운영 에러 수신. 어떤 입력에도 204 — 수집 실패가 앱에 드러나면 안 된다.
 * `/api/**`는 BE 프록시라 쓸 수 없고, `_` 접두 파일은 pathless 레이아웃이라 이 경로를 쓴다.
 */
export const Route = createFileRoute("/report-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const origin = request.headers.get("origin")
          const allowAny = process.env.REPORT_ERROR_ALLOW_ANY_ORIGIN === "true"
          if (!allowAny && origin !== ALLOWED_ORIGIN) return NO_CONTENT()
          // Origin은 위조 가능하다 — 남용으로 노션 한도(3rps)가 소진되면 정상 리포트까지 유실되므로 상한을 둔다
          if (!allowReport()) return NO_CONTENT()

          const length = Number(request.headers.get("content-length") ?? 0)
          if (length > MAX_BODY_BYTES) return NO_CONTENT()
          const text = await request.text()
          if (text.length > MAX_BODY_BYTES) return NO_CONTENT()

          const report = parseErrorReport(JSON.parse(text))
          if (!report) return NO_CONTENT()

          const token = process.env.NOTION_TOKEN
          const databaseId = process.env.NOTION_QA_DB_ID
          if (!token || !databaseId) {
            if (!warnedMissingEnv) {
              warnedMissingEnv = true
              console.warn(
                "[report-error] NOTION_TOKEN/NOTION_QA_DB_ID 미설정 — 기록 생략"
              )
            }
            return NO_CONTENT()
          }

          const requestOrigin = new URL(request.url).origin
          if (mapFetcher?.origin !== requestOrigin)
            mapFetcher = {
              origin: requestOrigin,
              fetchMap: createMapFetcher(requestOrigin),
            }

          await ingestErrorReport(report, {
            notion: createQaNotionClient({ token, databaseId }),
            fetchMap: mapFetcher.fetchMap,
          })
        } catch {
          // 수신 라우트 자체의 실패는 보고하지 않는다 (재귀 방지)
        }
        return NO_CONTENT()
      },
    },
  },
})
