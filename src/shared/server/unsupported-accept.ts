// TanStack Start는 Accept에 */* 나 text/html이 없는 요청을 라우터 매칭 뒤 500으로 거절한다
// (start-server-core createStartHandler executeRouter). 봇의 /llms.txt 같은 요청이 5xx로 기록되고 응답도 500이 된다.
const UNSUPPORTED_ACCEPT_MESSAGE = "Only HTML requests are supported here"

export async function isUnsupportedAcceptResponse(
  response: Response
): Promise<boolean> {
  if (response.status !== 500) return false
  if (!response.headers.get("content-type")?.includes("application/json"))
    return false
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    body.error === UNSUPPORTED_ACCEPT_MESSAGE
  )
}

/** 클라이언트가 HTML을 받지 않겠다는 요청이므로 서버 오류(500)가 아니라 406으로 응답한다. */
export function notAcceptableResponse(): Response {
  return Response.json({ error: UNSUPPORTED_ACCEPT_MESSAGE }, { status: 406 })
}
