import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server"
import { createServerEntry } from "@tanstack/react-start/server-entry"

import { ingestServerError } from "@/shared/server/ingest-error"
import {
  isUnsupportedAcceptResponse,
  notAcceptableResponse,
} from "@/shared/server/unsupported-accept"

// 기본 엔트리(@tanstack/react-start/server-entry)와 동일하되 SSR 예외·5xx를 에러 수집기에 남긴다.
const handler = createStartHandler(defaultStreamHandler)

const fetch: typeof handler = async (request, ...rest) => {
  try {
    const response = await handler(request, ...rest)
    // 실패 응답 경로만 기다린다 — Vercel은 응답 후 인스턴스를 멈출 수 있어 fire-and-forget이면 기록이 유실된다
    // HTML을 받지 않는 요청(봇의 /llms.txt 등)은 서버 오류가 아니다 — 500 대신 406으로 답하고 기록하지 않는다
    if (await isUnsupportedAcceptResponse(response))
      return notAcceptableResponse()
    if (response.status >= 500)
      await ingestServerError(request, new Error(`HTTP ${response.status}`))
    return response
  } catch (error) {
    await ingestServerError(request, error)
    throw error
  }
}

export default createServerEntry({ fetch })
