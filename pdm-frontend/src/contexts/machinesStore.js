import { createContext, useContext } from 'react'

export const MachinesContext = createContext(null)

// Where a newly added machine's PLC is on the network. Read only by the
// Machines page's "Test connection" probe — acquisition itself is configured in
// the Node-RED flow, not here.
export const EMPTY_SOURCE = {
  protocol: 'modbus-tcp',
  host: '',
  port: 502,
  unit_id: 1,
}

export function useMachines() {
  const ctx = useContext(MachinesContext)
  if (!ctx) throw new Error('useMachines must be used inside MachinesProvider')
  return ctx
}
