/**
 * 함수 인스턴스 메모리 기준 고정 윈도 카운터. 공개 수신 라우트의 남용·노션 한도(3rps) 보호용.
 * ponytail: 인스턴스별 카운터라 다중 인스턴스에선 limit × 인스턴스 수까지 통과한다. 남용이 보이면 KV 기반으로.
 */
export function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number = Date.now
): () => boolean {
  let windowStart = now()
  let count = 0
  return () => {
    const current = now()
    if (current - windowStart >= windowMs) {
      windowStart = current
      count = 0
    }
    count += 1
    return count <= limit
  }
}
