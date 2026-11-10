import { describe, expect, it } from "vitest"

import { navigationMotion } from "./navigation-motion"

describe("navigationMotion", () => {
  it.each([
    ["/my-page", "/my-page/profile-edit"],
    ["/my-page", "/my-page/feedback"],
    ["/my-page", "/my-page/blocked-users"],
    ["/my-page", "/my-page/pot/pot-1"],
    ["/travel-album", "/travel-album/서울"],
    ["/pot-start", "/pot-create"],
    ["/pot-start", "/pot-join"],
  ])("classifies %s → %s as a detail entry", (from, to) => {
    expect(navigationMotion(from, to)).toBe("app-detail-forward")
  })

  it.each([
    ["/my-page/profile-edit", "/my-page"],
    ["/travel-album/서울", "/travel-album"],
    ["/pot-create", "/pot-start"],
  ])("classifies %s → %s as a detail return", (from, to) => {
    expect(navigationMotion(from, to)).toBe("app-detail-back")
  })

  it.each([
    ["/map-google", "/travel-album"],
    ["/travel-album", "/my-page"],
    ["/my-page", "/map-google"],
  ])("classifies %s → %s as a root tab change", (from, to) => {
    expect(navigationMotion(from, to)).toBe("app-tab")
  })

  it("uses a restrained fade for redirects and unrelated routes", () => {
    expect(navigationMotion("/login/callback", "/map-google")).toBe("app-fade")
    expect(navigationMotion(undefined, "/")).toBe("app-fade")
  })
})
