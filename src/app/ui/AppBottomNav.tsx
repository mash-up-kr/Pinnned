import { useRouter, useRouterState } from "@tanstack/react-router"

import { useAllPhotos } from "@/entities/photo"
import { usePotStore } from "@/entities/travel-pot"
import { useSessionStore } from "@/entities/user"
import { BottomNav } from "@/widgets/bottom-nav"
import { useAppBottomNav } from "@/shared/ui/app-bottom-nav-context"

function AppBottomNav() {
  const router = useRouter()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const currentPotId = usePotStore((state) => state.currentPotId)
  const userId = useSessionStore((state) => state.currentUser?.id ?? null)
  const photos = useAllPhotos(currentPotId, userId)
  const { mapState, recenterMap } = useAppBottomNav()

  const active =
    pathname === "/travel-album"
      ? "album"
      : pathname === "/my-page"
        ? "my-page"
        : undefined
  const isMap = pathname === "/map-google"
  const isTabPage = isMap || active !== undefined

  if (!isTabPage || (isMap && !mapState.visible)) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom),34px)] z-10">
      <BottomNav
        className="pointer-events-auto"
        active={active}
        albumDisabled={isMap ? mapState.albumDisabled : photos.length === 0}
        onAlbumClick={() => router.navigate({ to: "/travel-album" })}
        onMyPageClick={() => router.navigate({ to: "/my-page" })}
        onGlobeClick={() => {
          if (isMap) recenterMap()
          else void router.navigate({ to: "/map-google" })
        }}
      />
    </div>
  )
}

export { AppBottomNav }
