import { trackEvent } from "@/shared/api/analytics"

export type InviteShareMethod = "share_sheet" | "copy_link" | "copy_code"
export type InviteShareScreen = "pot_created" | "my_pot"

// 초대 루프(공유 → 링크 열림 → 참여)의 첫 단계. 초대코드 자체는 보내지 않는다.
export function trackInviteShared(
  method: InviteShareMethod,
  screen: InviteShareScreen
): void {
  trackEvent("pot_invite_shared", { metadata: { method, screen } })
}

const OPENED_KEY = "udumeoli:analytics:invite-opened"

/**
 * 초대 링크·QR로 들어온 순간을 한 번 기록한다. 로그인 리다이렉트를 거쳐 같은 탭에서
 * 다시 /pot-start에 오더라도 같은 코드는 다시 세지 않는다 (코드는 비교에만 쓰고 보내지 않는다).
 */
export function trackInviteLinkOpened(code: string): void {
  try {
    if (window.sessionStorage.getItem(OPENED_KEY) === code) return
    window.sessionStorage.setItem(OPENED_KEY, code)
  } catch {
    // 저장소를 못 쓰면 중복 방지 없이 기록한다.
  }
  trackEvent("invite_link_opened")
}
