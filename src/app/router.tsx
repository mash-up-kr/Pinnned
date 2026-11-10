import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "../routeTree.gen"
import { navigationMotion } from "@/shared/lib/navigation-motion"

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultViewTransition: {
      types: ({ fromLocation, toLocation, pathChanged }) =>
        pathChanged
          ? [navigationMotion(fromLocation?.pathname, toLocation.pathname)]
          : false,
    },
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
