// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import { trackInviteLinkOpened, trackInviteShared } from "./invite-tracking"

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }))

vi.mock("@/shared/api/analytics", () => ({ trackEvent: trackEventMock }))

describe("invite tracking", () => {
  beforeEach(() => {
    trackEventMock.mockReset()
    window.sessionStorage.clear()
  })

  it("records the share method and screen without the invite code", () => {
    trackInviteShared("share_sheet", "pot_created")
    expect(trackEventMock).toHaveBeenCalledWith("pot_invite_shared", {
      metadata: { method: "share_sheet", screen: "pot_created" },
    })
  })

  it("counts an invite link once per code in a tab and never sends the code", () => {
    trackInviteLinkOpened("abc123")
    trackInviteLinkOpened("abc123")
    trackInviteLinkOpened("zzz999")

    expect(trackEventMock.mock.calls).toEqual([
      ["invite_link_opened"],
      ["invite_link_opened"],
    ])
  })
})
