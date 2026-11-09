import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "../routeTree.gen"
import { ErrorFallback } from "./error-fallback"

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // 렌더·로더 에러를 사용자에게 보여주고 에러 수집기로 보낸다
    defaultErrorComponent: ErrorFallback,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
