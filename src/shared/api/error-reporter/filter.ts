// 노이즈 판정 — 우리 코드가 원인일 수 없는 에러는 노션에 쌓지 않는다.
const IGNORED_MESSAGE_PATTERNS = [
  /^Script error\.?$/, // 크로스오리진 스크립트: 내용을 알 수 없는 빈 에러
  /^ResizeObserver loop/, // 브라우저가 내는 무해한 경고
  /AbortError/, // 사용자가 탭을 닫거나 요청을 취소한 것
]

const THIRD_PARTY_ORIGINS = [
  "clarity.ms",
  "googletagmanager.com",
  "google-analytics.com",
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "safari-web-extension://",
]

const FRAME_URL_PATTERN =
  /(?:https?|chrome-extension|moz-extension|safari-extension|safari-web-extension):\/\/[^\s)]+/g

export function shouldIgnoreError(input: {
  message: string
  stack?: string
}): boolean {
  if (IGNORED_MESSAGE_PATTERNS.some((pattern) => pattern.test(input.message)))
    return true

  const frameUrls = input.stack?.match(FRAME_URL_PATTERN) ?? []
  if (frameUrls.length === 0) return false
  return frameUrls.every((url) =>
    THIRD_PARTY_ORIGINS.some((origin) => url.includes(origin))
  )
}
