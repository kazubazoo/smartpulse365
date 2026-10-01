// Only the actual output frequency is plotted. The commanded frequency has no
// field in the MQTT guideline payload, so it never arrives — and a legend entry
// for a line that is always absent reads as a fault in the sensor rather than a
// gap in the payload. The chart says so in a footnote instead.
export const ACTUAL_FREQ = [
  { name: 'OutputFrequency', field: 'frequency', color: '#FBBF24' },
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
export const THERMAL = [
  { name: 'MotorTemp', field: 'temperature', color: '#FB923C' },
  { name: 'SensorChipTemp', field: 'sensor_chip_temp', color: '#94A3B8', dash: '6 4', width: 1.5 },
]

// Per-axis fault diagnosis codes reported by the WTVB01-485 (D419-D421).
//
// These are categorical codes, not magnitudes: code 20 is not "more" than code
// 10, it is a different diagnosis. They are rendered by FaultCodeTimeline as one
// lane per axis — no numeric axis to imply ordering, and no axis hidden beneath
// another when two of them report the same code. Colour is assigned by the
// component, so no `color` is set here.
export const FAULT_CODES = [
  { name: 'X', field: 'fault_x' },
  { name: 'Y', field: 'fault_y' },
  { name: 'Z', field: 'fault_z' },
]
