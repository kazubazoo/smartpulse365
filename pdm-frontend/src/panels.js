export const SET_VS_ACTUAL_FREQ = [
  { name: 'SetFrequency', field: 'speed_command_hz', color: '#34D399' },
  { name: 'ActualFrequency', field: 'frequency', color: '#FBBF24' },
]

export const VIBRATION = [
  { name: 'X', field: 'vibration_x', color: '#38BDF8' },
  { name: 'Y', field: 'vibration_y', color: '#34D399' },
  { name: 'Z', field: 'vibration_z', color: '#2563EB' },
]

export const DISPLACEMENT = [
  { name: 'X', field: 'disp_x', color: '#38BDF8' },
  { name: 'Y', field: 'disp_y', color: '#34D399' },
  { name: 'Z', field: 'disp_z', color: '#2563EB' },
]

export const FREQUENCY = [
  { name: 'X', field: 'vib_freq_x', color: '#38BDF8' },
  { name: 'Y', field: 'vib_freq_y', color: '#34D399' },
  { name: 'Z', field: 'vib_freq_z', color: '#2563EB' },
  { name: 'RunningSpeed', field: 'rpm', derive: r => r.rpm / 60, color: '#94A3B8', dash: '6 4', width: 1.5 },
]

export const VHZ = [
  { name: 'Voltage', field: 'voltage', color: '#38BDF8', axis: 'left' },
  { name: 'Frequency', field: 'frequency', color: '#34D399', axis: 'right' },
]

export const LOAD = [
  { name: 'RPM', field: 'rpm', color: '#38BDF8', axis: 'left' },
  { name: 'Power', field: 'power', color: '#34D399', axis: 'right' },
]

export const CURRENT_TORQUE = [
  { name: 'Current', field: 'current', color: '#38BDF8', axis: 'left' },
  { name: 'Torque', field: 'torque', color: '#34D399', axis: 'right' },
]

export const ACCELERATION = [
  { name: 'X', field: 'accel_x', color: '#38BDF8' },
  { name: 'Y', field: 'accel_y', color: '#34D399' },
  { name: 'Z', field: 'accel_z', color: '#2563EB' },
]