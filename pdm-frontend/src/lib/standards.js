// Vibration severity standards.
//
// A threshold is only meaningful against a standard. 4.5 mm/s is a damage-level
// reading on a 5 kW fan and an ordinary one on a 2 MW compressor, so the limits
// cannot be a single global setting — they are decided by the machine's power,
// its shaft height and how it is mounted. This module holds the published zone
// tables and the rules for picking the right row of them.
//
// Every table is broad-band RMS velocity in mm/s, measured on the bearing
// housings, which is what the WTVB01-485 reports.
//
// Zone meanings, common to all of these standards:
//   A  newly commissioned machine
//   B  acceptable for unrestricted long-term operation
//   C  unsatisfactory for long-term operation; run only until it can be fixed
//   D  severe enough to cause damage
//
// The dashboard maps them as: warning = B/C boundary, critical = C/D boundary.

export const ZONE_NOTES = {
  ab: 'Newly commissioned machines normally sit below this.',
  bc: 'Above this the machine is unsatisfactory for long-term running — this raises a fault row.',
  cd: 'Damage-level vibration. Above this, plan an immediate stop.',
}

// ---------------------------------------------------------------------------
// ISO 10816-1 — general classification by machine size and foundation.
// The classic four-class table. This is what the dashboard's original hard-coded
// 1.8 / 4.5 defaults came from (Class I), so it stays the default.
// ---------------------------------------------------------------------------
const ISO_10816_1_CLASSES = [
  {
    id: 'class-1',
    label: 'Class I — Small machines',
    detail: 'Up to 15 kW. Small motors, pumps and fans.',
    ab: 0.71, bc: 1.8, cd: 4.5,
  },
  {
    id: 'class-2',
    label: 'Class II — Medium machines',
    detail: '15–75 kW, or up to 300 kW on a dedicated foundation.',
    ab: 1.12, bc: 2.8, cd: 7.1,
  },
  {
    id: 'class-3',
    label: 'Class III — Large, rigid foundation',
    detail: 'Large prime movers on rigid, heavy foundations.',
    ab: 1.8, bc: 4.5, cd: 11.2,
  },
  {
    id: 'class-4',
    label: 'Class IV — Large, flexible foundation',
    detail: 'Large prime movers on soft or flexible foundations; turbomachinery.',
    ab: 2.8, bc: 7.1, cd: 18.0,
  },
]

// ---------------------------------------------------------------------------
// ISO 10816-3 / ISO 20816-3 — industrial machines above 15 kW.
//
// 20816-3:2022 supersedes 10816-3 and carries the same velocity zone
// boundaries, so both ids resolve to this table. Group is set by rated power
// and shaft height; support is rigid or flexible.
// ---------------------------------------------------------------------------
const ISO_20816_3_CLASSES = [
  {
    id: 'group2-rigid',
    label: 'Group 2 — Medium, rigid support',
    detail: '15–300 kW, or electrical machines with 160 mm ≤ shaft height < 315 mm.',
    ab: 1.4, bc: 2.8, cd: 4.5,
  },
  {
    id: 'group2-flexible',
    label: 'Group 2 — Medium, flexible support',
    detail: '15–300 kW on a flexible support.',
    ab: 2.3, bc: 4.5, cd: 7.1,
  },
  {
    id: 'group1-rigid',
    label: 'Group 1 — Large, rigid support',
    detail: '300 kW – 50 MW, or electrical machines with shaft height ≥ 315 mm.',
    ab: 2.3, bc: 4.5, cd: 7.1,
  },
  {
    id: 'group1-flexible',
    label: 'Group 1 — Large, flexible support',
    detail: '300 kW – 50 MW on a flexible support.',
    ab: 3.5, bc: 7.1, cd: 11.0,
  },
]

export const STANDARDS = [
  {
    id: 'iso-10816-1',
    label: 'ISO 10816-1',
    blurb: 'General classification by machine size and foundation. Good default for a single motor.',
    classes: ISO_10816_1_CLASSES,
    classLabel: 'Machine class',
  },
  {
    id: 'iso-20816-3',
    label: 'ISO 20816-3',
    blurb: 'Current standard for industrial machines above 15 kW. Supersedes ISO 10816-3.',
    classes: ISO_20816_3_CLASSES,
    classLabel: 'Group and support',
  },
  {
    id: 'iso-10816-3',
    label: 'ISO 10816-3',
    blurb: 'Withdrawn in favour of ISO 20816-3, kept for sites whose paperwork still cites it. Same zone boundaries.',
    classes: ISO_20816_3_CLASSES,
    classLabel: 'Group and support',
  },
  {
    id: 'custom',
    label: 'Custom',
    blurb: 'Enter your own limits — for equipment no published table covers, or an OEM specification.',
    classes: [],
    classLabel: null,
  },
]

export function getStandard(id) {
  return STANDARDS.find(s => s.id === id) ?? STANDARDS[0]
}

export function getStandardClass(standardId, classId) {
  const std = getStandard(standardId)
  return std.classes.find(c => c.id === classId) ?? std.classes[0] ?? null
}

// ---------------------------------------------------------------------------
// Choosing the class from the machine's nameplate
// ---------------------------------------------------------------------------

/** Suggest a class from rated power, shaft height and mounting.
 *
 * Returns null when there is not enough information rather than guessing —
 * a wrong class silently mis-scales every alarm on the machine.
 */
export function suggestClass(standardId, { powerKw, shaftHeightMm, mounting }) {
  const power = Number(powerKw)
  const height = Number(shaftHeightMm)
  const flexible = mounting === 'flexible'

  if (standardId === 'iso-10816-1') {
    if (!Number.isFinite(power) || power <= 0) return null
    if (power <= 15) return 'class-1'
    if (power <= 300) return 'class-2'
    return flexible ? 'class-4' : 'class-3'
  }

  if (standardId === 'iso-20816-3' || standardId === 'iso-10816-3') {
    // Shaft height wins when it is known: for electrical machines the standard
    // defines the group by frame size, not by rating.
    let large
    if (Number.isFinite(height) && height > 0) {
      large = height >= 315
    } else if (Number.isFinite(power) && power > 0) {
      large = power > 300
    } else {
      return null
    }
    const group = large ? 'group1' : 'group2'
    return `${group}-${flexible ? 'flexible' : 'rigid'}`
  }

  return null
}

/** Why a suggestion was made, for the UI to show under the picker. */
export function explainSuggestion(standardId, { powerKw, shaftHeightMm, mounting }) {
  const power = Number(powerKw)
  const height = Number(shaftHeightMm)
  const support = mounting === 'flexible' ? 'flexible support' : 'rigid support'

  if (standardId === 'iso-10816-1') {
    if (!Number.isFinite(power) || power <= 0) return 'Enter the rated power to get a suggestion.'
    if (power <= 15) return `${power} kW is a small machine (≤ 15 kW).`
    if (power <= 300) return `${power} kW is a medium machine (15–300 kW).`
    return `${power} kW is a large machine on a ${support}.`
  }

  if (standardId === 'iso-20816-3' || standardId === 'iso-10816-3') {
    if (Number.isFinite(height) && height > 0) {
      return `Shaft height ${height} mm ${height >= 315 ? '≥ 315 mm → Group 1' : '< 315 mm → Group 2'}, ${support}.`
    }
    if (Number.isFinite(power) && power > 0) {
      return `${power} kW ${power > 300 ? '> 300 kW → Group 1' : '≤ 300 kW → Group 2'}, ${support}. Shaft height would be more precise.`
    }
    return 'Enter the rated power or shaft height to get a suggestion.'
  }

  return 'Custom limits are entered by hand; no suggestion applies.'
}

// ---------------------------------------------------------------------------
// Resolving a machine's configuration into the numbers the API is called with
// ---------------------------------------------------------------------------

/** The alarm limits implied by a machine's standard selection.
 *
 * For a published standard the boundaries come from the table, so they cannot
 * drift out of step with the class. For `custom` the stored values are used
 * as-is.
 */
export function resolveLimits(config) {
  if (!config) return null
  if (config.standardId === 'custom') {
    return {
      vibWarn: config.vibWarn,
      vibCritical: config.vibCritical,
      vibScale: config.vibScale,
      source: 'custom',
    }
  }

  const cls = getStandardClass(config.standardId, config.classId)
  if (!cls) return null

  return {
    vibWarn: cls.bc,
    vibCritical: cls.cd,
    // Health reaches zero at the top of Zone D's entry point. Using the C/D
    // boundary means a machine sitting exactly at "damaging" scores 0, which
    // is the reading an operator expects.
    vibScale: cls.cd,
    zoneAB: cls.ab,
    source: cls.label,
  }
}

export const MOUNTING_OPTIONS = [
  { id: 'rigid', label: 'Rigid', detail: 'Bolted to a heavy foundation or baseplate.' },
  { id: 'flexible', label: 'Flexible', detail: 'Anti-vibration mounts, springs, or a light frame.' },
]
