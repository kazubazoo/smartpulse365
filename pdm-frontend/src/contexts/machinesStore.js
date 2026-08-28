import { createContext, useContext } from 'react'

export const MachinesContext = createContext(null)

// Default acquisition settings for a newly added machine.
export const EMPTY_SOURCE = {
  protocol: 'modbus-tcp',
  host: '',
  port: 502,
  unit_id: 1,
  poll_ms: 1000,
  measurement: 'motor_metrics',
}

export function useMachines() {
  const ctx = useContext(MachinesContext)
  if (!ctx) throw new Error('useMachines must be used inside MachinesProvider')
  return ctx
}
