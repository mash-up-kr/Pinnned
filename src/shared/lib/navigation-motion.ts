export type NavigationMotion =
  | "app-detail-forward"
  | "app-detail-back"
  | "app-tab"
  | "app-fade"

const ROOT_TABS = new Set(["/map-google", "/travel-album", "/my-page"])

function parentPath(pathname: string): string | null {
  if (
    /^\/my-page\/(?:profile-edit|feedback|blocked-users|pot\/[^/]+)$/.test(
      pathname
    )
  ) {
    return "/my-page"
  }
  if (/^\/travel-album\/[^/]+$/.test(pathname)) return "/travel-album"
  if (/^\/pot-(?:create|join)$/.test(pathname)) return "/pot-start"
  if (pathname === "/signup") return "/"
  return null
}

/** 화면 계층에 따라 View Transition의 시각적 의미를 정한다. */
export function navigationMotion(
  fromPathname: string | undefined,
  toPathname: string
): NavigationMotion {
  if (!fromPathname || fromPathname === toPathname) return "app-fade"
  if (ROOT_TABS.has(fromPathname) && ROOT_TABS.has(toPathname)) {
    return "app-tab"
  }
  if (parentPath(toPathname) === fromPathname) return "app-detail-forward"
  if (parentPath(fromPathname) === toPathname) return "app-detail-back"
  return "app-fade"
}
