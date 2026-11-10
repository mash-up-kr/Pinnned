import { SourceMapConsumer } from "source-map-js"

export interface ResolvedStack {
  /** 복원된 스택 텍스트. 복원 실패 시 원본 그대로 */
  text: string
  resolved: boolean
  /** 최상위 자사 프레임 "src/features/x/Foo.tsx:42" — 지문 계산용 */
  topFrame?: string
}

const OWN_BUNDLE_FRAME = /(https?:\/\/[^\s)]+?\.js):(\d+):(\d+)/
const THIRD_PARTY_HOSTS = [
  "clarity.ms",
  "googletagmanager.com",
  "google-analytics.com",
]

function isOwnBundle(url: string): boolean {
  return !THIRD_PARTY_HOSTS.some((host) => url.includes(host))
}

/** "../src/x.ts" → "src/x.ts". 빌드 산출물 기준 상대 경로를 레포 기준으로 정리한다. */
function cleanSourcePath(source: string): string {
  const index = source.indexOf("src/")
  return index >= 0 ? source.slice(index) : source
}

/** 200이지만 맵이 아닌 응답(HTML 에러 페이지 등)은 복원 실패로 취급한다 — 기록 자체가 사라지면 안 된다. */
function parseConsumer(raw: string): SourceMapConsumer | null {
  try {
    return new SourceMapConsumer(JSON.parse(raw))
  } catch {
    return null
  }
}

const MAP_FETCH_TIMEOUT_MS = 3000

/**
 * 압축 스택의 자사 번들 프레임을 원본 위치로 바꾼다.
 * 프레임 열은 브라우저 기준 1-based, source-map은 0-based라 1을 뺀다.
 */
export async function resolveStack(
  stack: string,
  options: { fetchMap: (mapUrl: string) => Promise<string | null> }
): Promise<ResolvedStack> {
  const consumers = new Map<string, SourceMapConsumer | null>()
  let resolved = false
  let topFrame: string | undefined

  const lines: Array<string> = []
  for (const line of stack.split("\n")) {
    const match = OWN_BUNDLE_FRAME.exec(line)
    if (!match || !isOwnBundle(match[1])) {
      lines.push(line)
      continue
    }
    const [, bundleUrl, lineText, columnText] = match
    let consumer = consumers.get(bundleUrl)
    if (consumer === undefined) {
      const raw = await options.fetchMap(`${bundleUrl}.map`)
      consumer = raw ? parseConsumer(raw) : null
      consumers.set(bundleUrl, consumer)
    }
    const position = consumer?.originalPositionFor({
      line: Number(lineText),
      column: Number(columnText) - 1,
    })
    // 타입은 non-null이지만 매핑이 없으면 런타임에 null이 온다 (source-map-js 문서)
    const source = position?.source as string | null | undefined
    if (!position || !source) {
      lines.push(line)
      continue
    }
    const file = cleanSourcePath(source)
    lines.push(
      line.replace(match[0], `${file}:${position.line}:${position.column + 1}`)
    )
    resolved = true
    topFrame ??= `${file}:${position.line}`
  }

  return { text: resolved ? lines.join("\n") : stack, resolved, topFrame }
}

/**
 * 같은 origin의 .map을 내려받아 함수 인스턴스 메모리에 캐시한다. 404·예외는 null.
 * ponytail: 재배포 직후 옛 번들 해시의 .map은 404라 복원이 안 된다. 빈도가 낮아 "복원 실패"로 표시만 한다.
 */
export function createMapFetcher(
  origin: string
): (mapUrl: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>()
  return (mapUrl) => {
    if (!mapUrl.startsWith(origin)) return Promise.resolve(null)
    let pending = cache.get(mapUrl)
    if (!pending) {
      pending = fetch(mapUrl, {
        signal: AbortSignal.timeout(MAP_FETCH_TIMEOUT_MS),
      })
        .then((res) => (res.ok ? res.text() : null))
        .catch(() => null)
      cache.set(mapUrl, pending)
    }
    return pending
  }
}
