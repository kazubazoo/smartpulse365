// Declarative chart configuration for the Diagnostics page.
//
// Each export is the series list for one chart: `field` is the key in an API
// row, `name` is what the legend and tooltip show. Adding a chart means adding
// an array here and one <TimeSeriesChart> in DiagnosticsPage.jsx — no new
// component. Optional per-series keys: `axis` ('left' | 'right', dual-axis
// charts only), `derive` (compute the plotted value from the row), `dash`
// (stroke-dasharray) and `width`.
//
// Acceleration (accel_x/y/z) is deliberately not charted: the WTVB01-485 does
// not expose raw acceleration and those registers always read zero. See
// "Known hardware limitation" in CLAUDE.md.

// Only the actual output frequency is plotted. The commanded frequency has no
// field in the MQTT guideline payload, so it never arrives — and a legend entry
// for a line that is always absent reads as a fault in the sensor rather than a
// gap in the payload. The chart says so in a footnote instead.
export const ACTUAL_FREQ = [
  { name: 'Output frequency', field: 'frequency', color: '#FBBF24' },
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
  { name: 'Running speed', field: 'rpm', derive: r => r.rpm / 60, color: '#94A3B8', dash: '6 4', width: 1.5 },
]

export const VHZ = [
  { name: 'Voltage', field: 'voltage', color: '#38BDF8', axis: 'left' },
  { name: 'Frequency', field: 'frequency', color: '#34D399', axis: 'right' },
]

export const LOAD = [
  { name: 'Speed', field: 'rpm', color: '#38BDF8', axis: 'left' },
  { name: 'Power', field: 'power', color: '#34D399', axis: 'right' },
]

export const CURRENT_TORQUE = [
  { name: 'Current', field: 'current', color: '#38BDF8', axis: 'left' },
  { name: 'Torque', field: 'torque', color: '#34D399', axis: 'right' },
]

export const THERMAL = [
  { name: 'Motor', field: 'temperature', color: '#FB923C' },
  { name: 'Sensor chip', field: 'sensor_chip_temp', color: '#94A3B8', dash: '6 4', width: 1.5 },
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
