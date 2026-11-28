import { useRouter, useRouterState } from "@tanstack/react-router"

import { useAllPhotos } from "@/entities/photo"
import { usePotStore } from "@/entities/travel-pot"
import { useSessionStore } from "@/entities/user"
import { useMapTipsOpen } from "@/features/onboarding"
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
  // 지도 사용 안내는 내비까지 덮는 화면이다 — 내비가 안내 위에 떠서 눌리지 않게 숨긴다
  const mapTipsOpen = useMapTipsOpen()

  const active =
    pathname === "/travel-album"
      ? "album"
      : pathname === "/my-page"
        ? "my-page"
        : undefined
  const isMap = pathname === "/map-google"
  const isTabPage = isMap || active !== undefined

  if (!isTabPage || mapTipsOpen || (isMap && !mapState.visible)) return null

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
