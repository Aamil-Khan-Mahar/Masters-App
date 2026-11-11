import { createContext, useContext } from 'react'

/** True inside Apply mode's program page: program-wide research (Research again, fetching the faculty list, Refresh funding) is hidden there. Researching one person stays available for picking supervisors. */
export const ReadOnly = createContext(false)
export const useReadOnly = () => useContext(ReadOnly)
