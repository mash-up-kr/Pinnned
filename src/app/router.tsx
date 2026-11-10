import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "../routeTree.gen"
import { ErrorFallback } from "./error-fallback"
import { navigationMotion } from "@/shared/lib/navigation-motion"

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // 렌더·로더 에러를 사용자에게 보여주고 에러 수집기로 보낸다
    defaultErrorComponent: ErrorFallback,
    defaultViewTransition: {
      types: ({ fromLocation, toLocation, pathChanged }) => {
        if (!pathChanged) return false
        const motion = navigationMotion(
          fromLocation?.pathname,
          toLocation.pathname
        )
        // 공통 탭바가 있는 탭 이동은 DOM을 그대로 유지하고 스냅샷 전환을 생략한다.
        return motion === "app-tab" ? false : [motion]
      },
    },
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
