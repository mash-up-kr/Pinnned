import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server"
import { createServerEntry } from "@tanstack/react-start/server-entry"

import { ingestServerError } from "@/shared/server/ingest-error"

// 기본 엔트리(@tanstack/react-start/server-entry)와 동일하되 SSR 예외·5xx를 에러 수집기에 남긴다.
const handler = createStartHandler(defaultStreamHandler)

const fetch: typeof handler = async (request, ...rest) => {
  try {
    const response = await handler(request, ...rest)
    if (response.status >= 500)
      void ingestServerError(request, new Error(`HTTP ${response.status}`))
    return response
  } catch (error) {
    void ingestServerError(request, error)
    throw error
  }
}

export default createServerEntry({ fetch })
