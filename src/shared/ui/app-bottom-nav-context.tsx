import * as React from "react"

type MapBottomNavState = {
  visible: boolean
  albumDisabled: boolean
}

type AppBottomNavContextValue = {
  mapState: MapBottomNavState
  setMapState: React.Dispatch<React.SetStateAction<MapBottomNavState>>
  recenterSignal: number
  recenterMap: () => void
}

const AppBottomNavContext =
  React.createContext<AppBottomNavContextValue | null>(null)

function AppBottomNavProvider({ children }: { children: React.ReactNode }) {
  const [mapState, setMapState] = React.useState<MapBottomNavState>({
    visible: false,
    albumDisabled: true,
  })
  const [recenterSignal, setRecenterSignal] = React.useState(0)
  const recenterMap = React.useCallback(
    () => setRecenterSignal((signal) => signal + 1),
    []
  )

  return (
    <AppBottomNavContext.Provider
      value={{ mapState, setMapState, recenterSignal, recenterMap }}
    >
      {children}
    </AppBottomNavContext.Provider>
  )
}

function useAppBottomNav() {
  const context = React.useContext(AppBottomNavContext)
  if (!context) {
    throw new Error("useAppBottomNav must be used within AppBottomNavProvider")
  }
  return context
}

export { AppBottomNavProvider, useAppBottomNav }
