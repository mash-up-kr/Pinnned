// 노이즈 판정 — 우리 코드가 원인일 수 없는 에러는 노션에 쌓지 않는다.
const IGNORED_MESSAGE_PATTERNS = [
  /^Script error\.?$/, // 크로스오리진 스크립트: 내용을 알 수 없는 빈 에러
  /^ResizeObserver loop/, // 브라우저가 내는 무해한 경고
  /AbortError/, // 사용자가 탭을 닫거나 요청을 취소한 것
  /View transition was skipped because document visibility state is hidden/, // 탭이 백그라운드라 브라우저가 전환을 건너뜀
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
  name?: string
  stack?: string
}): boolean {
  // DOMException은 message에 이름이 안 들어간다 ("Transition was skipped...") — name도 함께 본다
  const texts = [input.message, `${input.name}: ${input.message}`]
  if (
    IGNORED_MESSAGE_PATTERNS.some((pattern) =>
      texts.some((text) => pattern.test(text))
    )
  )
    return true

  const frameUrls = input.stack?.match(FRAME_URL_PATTERN) ?? []
  if (frameUrls.length === 0) return false
  return frameUrls.every((url) =>
    THIRD_PARTY_ORIGINS.some((origin) => url.includes(origin))
  )
}
