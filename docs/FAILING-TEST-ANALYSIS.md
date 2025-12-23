# Failing Test Case Analysis: MSROBSPass4_33

## Executive Summary

**Test Results**: 145 of 146 tests pass (99.3%)

The single failing test (`MSROBSPass4_33`) is caused by a **data modeling inconsistency** in the test case, not a bug in the CQL execution engine. The test case uses non-standard FHIR semantics that contradict the QI-Core specification.

---

## Test Case Details

| Field | Value |
|-------|-------|
| **Test Name** | MSROBSPass4_33 |
| **Full Name** | MSROBSPass4 MultiEnc1STDiagnosisEnds |
| **UUID** | 95c5116d-15f0-4367-b467-dca152f6b43c |
| **Description** | "Multiple Encounters, diagnosis in first encounter has end date, no diagnosis in second encounter" |

---

## Clinical Timeline

```
                    May 2026                              July 2026
    ├─────────────────────────────────────┤     ├──────────────────────┤
    1st        6th                    10th      1st                  7th

    ├──────────┤
    │ Condition │  (onsetPeriod: May 1-6)
    │ "active"  │
    └──────────┘

    ├─────────────────────────────────────┤
    │         Encounter 1                  │  (May 1-10)
    └─────────────────────────────────────┘

                                                ├──────────────────────┤
                                                │    Encounter 2       │  (July 1-7)
                                                └──────────────────────┘
```

---

## Expected vs Actual Results

### Group_3 (Malnutrition Diagnosis)

| Observation | Expected | Actual | Status |
|-------------|----------|--------|--------|
| Obs1 (Encounter 1) | 1 | 1 | ✓ |
| Obs2 (Encounter 2) | 0 | **1** | ✗ |
| **Total** | **1** | **2** | ✗ |

### Group_5 (Total Malnutrition Components Score)

| Observation | Expected | Actual | Status |
|-------------|----------|--------|--------|
| Obs1 (Encounter 1) | 4 | 4 | ✓ |
| Obs2 (Encounter 2) | 3 | **4** | ✗ |

### Group_6 (Percentage)

| Observation | Expected | Actual | Status |
|-------------|----------|--------|--------|
| Obs1 (Encounter 1) | 100% | 100% | ✓ |
| Obs2 (Encounter 2) | 75% | **100%** | ✗ |

---

## Root Cause Analysis

### The Condition Resource

```json
{
  "resourceType": "Condition",
  "clinicalStatus": {
    "coding": [{ "code": "active" }]
  },
  "onsetPeriod": {
    "start": "2026-05-01T08:00:00.000Z",
    "end": "2026-05-06T08:00:00.000Z"
  }
  // NOTE: No "abatement" field!
}
```

### The CQL `prevalenceInterval()` Function

From `QICoreCommon-4.0.000.cql`:

```cql
define fluent function prevalenceInterval(condition):
  if condition.clinicalStatus ~ "active"
    or condition.clinicalStatus ~ "recurrence"
    or condition.clinicalStatus ~ "relapse" then
    Interval[start of condition.onset.toInterval(),
             end of condition.abatementInterval()]
  else
    (end of condition.abatementInterval()) abatementDate
    return if abatementDate is null then
      Interval[start of condition.onset.toInterval(), abatementDate)
    else
      Interval[start of condition.onset.toInterval(), abatementDate]
```

### What Happens

1. **clinicalStatus = "active"** → Uses the first branch (active condition)
2. **No abatement field** → `abatementInterval()` returns `null`
3. **Result**: `prevalenceInterval() = [2026-05-01, null)` (OPEN-ENDED)

### The Problem

An open-ended interval `[2026-05-01, ∞)` overlaps with BOTH encounters:

| Encounter | Period | Overlaps [2026-05-01, ∞)? |
|-----------|--------|---------------------------|
| 1 | May 1-10, 2026 | YES |
| 2 | July 1-7, 2026 | YES |

---

## Data Modeling Inconsistency

The test case contains contradictory data:

| Field | Value | Implication |
|-------|-------|-------------|
| `clinicalStatus` | "active" | Condition is **ongoing** |
| `onsetPeriod.end` | 2026-05-06 | Test author intended this as "condition ended" |

### FHIR/QI-Core Specification

According to FHIR R4 and QI-Core 6.0.0:

- **`onset[x]`**: When the condition **started** (onset phase)
  - `onsetPeriod.start`: Beginning of symptom manifestation
  - `onsetPeriod.end`: End of the **onset phase**, NOT when condition resolved

- **`abatement[x]`**: When the condition **resolved/ended**
  - `abatementDateTime`: Specific date/time condition resolved
  - `abatementPeriod`: Period during which condition resolved

The test case incorrectly uses `onsetPeriod.end` to mean "when the condition ended" - this is not the intended semantics in FHIR.

---

## Solution Options

### Option 1: Fix the Test Case Data (Recommended)

Correct the Condition resource to use proper FHIR semantics:

**Before (Incorrect):**
```json
{
  "clinicalStatus": { "coding": [{ "code": "active" }] },
  "onsetPeriod": {
    "start": "2026-05-01T08:00:00.000Z",
    "end": "2026-05-06T08:00:00.000Z"
  }
}
```

**After (Correct):**
```json
{
  "clinicalStatus": { "coding": [{ "code": "resolved" }] },
  "onsetDateTime": "2026-05-01T08:00:00.000Z",
  "abatementDateTime": "2026-05-06T08:00:00.000Z"
}
```

This would make `prevalenceInterval()` return `[2026-05-01, 2026-05-06]`:
- Overlaps Encounter 1 (May 1-10) ✓
- Does NOT overlap Encounter 2 (July 1-7) ✓

### Option 2: Accept as Known Edge Case (Current Approach)

Document that:
- 145/146 tests pass (99.3%)
- The 1 failure is due to non-standard test case data
- The CQL engine behavior is correct per specification

### Option 3: Non-Standard Interpretation (Not Recommended)

Modify the calculation logic to treat `onsetPeriod.end` as the condition end date. This would:
- Deviate from FHIR/QI-Core specifications
- Create potential compatibility issues with other measures
- Set a problematic precedent

---

## Verification

### CQL Logic Chain

```
"Encounters with Malnutrition Diagnosis" (CMS986FHIRMalnutritionScore-1.0.000.cql:220-226)
    ↓
"Has Malnutrition Diagnosis" where prevalenceInterval() overlaps encounter period
    ↓
prevalenceInterval() uses onset.toInterval() start and abatementInterval() end
    ↓
abatementInterval() returns NULL (no abatement field)
    ↓
Result: Open-ended interval overlaps both encounters
```

### Test Execution Output

```
[FAIL] MSROBSPass4 (MultiEnc1STDiagnosisEnds)
  Group_3 (Malnutrition Diagnosis):
    Obs1: expected=1, actual=2

  Group_5 (Total Components Score):
    Obs1: expected=4, actual=4
    Obs2: expected=3, actual=4

  Group_6 (Percentage):
    Obs1: expected=100, actual=100
    Obs2: expected=75, actual=100
```

---

## Conclusion

The CQL execution engine is behaving **correctly** according to FHIR R4 and QI-Core 6.0.0 specifications. The single failing test case contains a data modeling error where:

1. `clinicalStatus = "active"` implies the condition is ongoing
2. `onsetPeriod.end` was used to indicate when the condition ended (incorrect usage)
3. The proper field for "condition ended" is `abatement[x]`

### Recommendation

Report this as a test case data issue to the MADiE team. The fix is straightforward:
- Change `clinicalStatus` from "active" to "resolved"
- Move the end date from `onsetPeriod.end` to `abatementDateTime`

---

## References

- [FHIR R4 Condition Resource](https://hl7.org/fhir/R4/condition.html)
- [QI-Core 6.0.0 Condition Profile](https://hl7.org/fhir/us/qicore/STU6/StructureDefinition-qicore-condition-encounter-diagnosis.html)
- [QICoreCommon Library](https://github.com/cqframework/clinical_quality_language)

---

*Document Version: 1.0*
*Last Updated: 2025-12-22*
*Related Test: MSROBSPass4_33 (UUID: 95c5116d-15f0-4367-b467-dca152f6b43c)*
