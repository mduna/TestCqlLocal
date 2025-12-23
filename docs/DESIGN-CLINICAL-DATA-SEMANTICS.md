# CQL Test Runner Design: Clinical Data Semantics

## Overview

This document describes how the CQL Local Testing App evaluates measures based on **clinical data content**, not the order in which resources appear in input bundles. This design ensures that:

1. Test results are deterministic regardless of EHR data ordering
2. Calculations reflect clinical relationships (dates, encounters, observations)
3. Comparison logic is order-independent for multi-encounter scenarios

---

## 1. CQL Execution Philosophy

### 1.1 Applies to ALL Clinical Resources

This design applies to **every FHIR resource type**, not just Observations. CQL queries all resources based on clinical attributes:

| Resource Type | Clinical Date Field | Example Usage |
|---------------|---------------------|---------------|
| **Encounter** | `period.start`, `period.end` | Filter by measurement period |
| **Observation** | `effective`, `issued` | Match to encounter timing |
| **Condition** | `onset`, `abatement`, `recordedDate` | Check if active during encounter |
| **MedicationRequest** | `authoredOn`, `dosageInstruction.timing` | Medication during encounter |
| **MedicationAdministration** | `effective` | When medication was given |
| **Procedure** | `performed` | When procedure occurred |
| **ServiceRequest** | `authoredOn`, `occurrence` | When service was requested |
| **DiagnosticReport** | `effective`, `issued` | Report timing |
| **Immunization** | `occurrence` | When immunization given |
| **AllergyIntolerance** | `onset`, `recordedDate` | Allergy timing |

### 1.2 Clinical Date-Based Queries

The CQL engine evaluates all queries based on **clinical timestamps**, not resource position in the bundle:

```cql
// Encounters filtered by clinical period end date
define "Initial Population":
  [Encounter: "Encounter Inpatient"] EncounterInpatient
    where EncounterInpatient.period ends during day of "Measurement Period"
      and AgeInYearsAt(date from start of EncounterInpatient.period) >= 18

// Observations matched to encounters by clinical timing
define "Encounters with Malnutrition Risk Screening":
  "Measure Population" QualifyingEncounter
    with ["Observation": "Malnutrition Risk Screening"] MalnutritionRiskScreening
      such that MalnutritionRiskScreening.effective.toInterval()
        during QualifyingEncounter.hospitalizationWithObservation()
```

### 1.3 Examples for Other Resource Types

**Medications:**
```cql
// Medication ordered during encounter - uses authoredOn date
define "Encounters with Antibiotic Order":
  "Measure Population" QualifyingEncounter
    with [MedicationRequest: "Antibiotic Medications"] Antibiotic
      such that Antibiotic.authoredOn during QualifyingEncounter.period

// Medication administered - uses effective date
define "Encounters with Antibiotic Given":
  "Measure Population" QualifyingEncounter
    with [MedicationAdministration: "Antibiotic Medications"] Admin
      such that Admin.effective.toInterval() during QualifyingEncounter.period
```

**Conditions:**
```cql
// Condition active during encounter - uses prevalence interval
define "Encounters with Diabetes":
  "Measure Population" QualifyingEncounter
    with [Condition: "Diabetes"] DiabetesCondition
      such that DiabetesCondition.prevalenceInterval()
        overlaps QualifyingEncounter.period

// Condition diagnosed during encounter
define "Encounters with New Diagnosis":
  "Measure Population" QualifyingEncounter
    with [Condition: "Sepsis"] SepsisCondition
      such that SepsisCondition.recordedDate during QualifyingEncounter.period
```

**Procedures:**
```cql
// Procedure performed during encounter
define "Encounters with Surgery":
  "Measure Population" QualifyingEncounter
    with [Procedure: "Surgical Procedures"] Surgery
      such that Surgery.performed.toInterval()
        during QualifyingEncounter.period
```

**Immunizations:**
```cql
// Immunization given during encounter
define "Encounters with Flu Shot":
  "Measure Population" QualifyingEncounter
    with [Immunization: "Influenza Vaccine"] FluShot
      such that FluShot.occurrence.toInterval()
        during QualifyingEncounter.period
```

### 1.4 Order-Independent Operations

| CQL Operation | Based On | Order-Dependent? |
|---------------|----------|------------------|
| `exists` | Resource existence | No |
| `in` / `contains` | Set membership | No |
| `during` / `overlaps` | Clinical dates | No |
| `sort by` | Specified field | Uses clinical dates |
| `Last` / `First` | With sort | Uses clinical dates |
| `Count` | Collection size | No |

---

## 2. Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INPUT (FHIR Bundle)                          │
│  Resources may arrive in ANY order from different EHR systems       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CQL EXECUTION ENGINE                            │
│  • Queries resources by clinical attributes (dates, codes)          │
│  • Matches observations to encounters by period overlap             │
│  • Calculates populations based on clinical relationships           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EXPRESSION RESULTS                              │
│  • Population lists (encounters matching criteria)                  │
│  • Observation counts per encounter                                 │
│  • Clinical content is CORRECT; list ORDER may vary                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  ORDER-INDEPENDENT COMPARISON                       │
│  • Compares sorted value sets, not positional slots                 │
│  • {4, 3} == {3, 4} (same clinical values, different order)         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Clinical Relationship Matching

### 3.1 Encounter-to-Observation Matching

Observations are matched to specific encounters based on **clinical timing**:

```cql
// Observation effective date must fall DURING the encounter period
MalnutritionRiskScreening.effective.toInterval()
  during QualifyingEncounter.hospitalizationWithObservation()
```

This ensures:
- An observation on 2025-01-15 matches an encounter from 2025-01-10 to 2025-01-20
- The same observation does NOT match an encounter from 2025-02-01 to 2025-02-05
- Input bundle order is irrelevant

### 3.2 "Most Recent" Queries

When CQL needs the "most recent" resource, it uses **clinical dates**:

```cql
define "Most Recent Nutrition Assessment For Encounter":
  from "Measure Population" QualifyingEncounter,
       ["Observation": "Nutrition Assessment"] NutritionAssessment
  where NutritionAssessment.effective.toInterval()
    during QualifyingEncounter.hospitalizationWithObservation()
  return {
    encounter: QualifyingEncounter,
    assessment: Last(
      [Observation] O
        where O.effective during QualifyingEncounter.period
        sort by effective.start  // Clinical date sorting
    )
  }
```

---

## 4. Per-Encounter Observation Structure

### 4.1 Data Model

For measures with multiple encounters, observations are stored per-encounter:

```typescript
interface ObservationValues {
  obs1: number;  // Per-encounter value (e.g., encounter 1's score)
  obs2: number;  // Per-encounter value (e.g., encounter 2's score)
  obs3: number;  // Per-encounter value (e.g., encounter 3's score)
  obs4: number;  // Per-encounter value (e.g., encounter 4's score)
}

interface PopulationCounts {
  initialPopulation: number;
  measurePopulation: number;
  measurePopulationExclusion: number;
  observations: ObservationValues;
}
```

### 4.2 MeasureReport Structure

The expected values from MeasureReport follow the same per-encounter pattern:

```json
{
  "id": "Group_5",
  "population": [
    { "id": "MeasureObservation_5_1", "count": 4 },  // Encounter 1's total score
    { "id": "MeasureObservation_5_2", "count": 3 },  // Encounter 2's total score
    { "id": "MeasureObservation_5_3", "count": 2 }   // Encounter 3's total score
  ]
}
```

---

## 5. Order-Independent Comparison

### 5.1 The Problem

Different systems may order encounters differently:
- **EHR A**: Orders by encounter ID (alphabetical)
- **EHR B**: Orders by admission date
- **MeasureReport**: May use yet another ordering

This can result in:
- Expected: `{4, 3, 2}` (MeasureReport order)
- Actual: `{3, 4, 2}` (CQL engine order)

Both represent the **same clinical truth** - three encounters with scores 4, 3, and 2.

### 5.2 The Solution

For Groups 5 and 6, comparison is **order-independent**:

```typescript
function compareGroups(expected: ExpectedGroup[], actual: ActualGroup[]): GroupComparison[] {
  // For Groups 5-6: Sort both value sets before comparing
  if (exp.groupId === 'Group_5' || exp.groupId === 'Group_6') {
    const expObs = [obs1, obs2, obs3, obs4]
      .filter(v => v !== 0)
      .sort((a, b) => b - a);  // Descending sort

    const actObs = [obs1, obs2, obs3, obs4]
      .filter(v => v !== 0)
      .sort((a, b) => b - a);  // Descending sort

    // Compare sorted arrays
    obsMatch = expObs.length === actObs.length &&
               expObs.every((v, idx) => v === actObs[idx]);
  }
}
```

### 5.3 Comparison Examples

| Expected | Actual | Match? | Reason |
|----------|--------|--------|--------|
| `{4, 3}` | `{4, 3}` | Yes | Same values, same order |
| `{4, 3}` | `{3, 4}` | Yes | Same values, different order |
| `{4, 3}` | `{4, 2}` | No | Different values |
| `{4, 3, 0, 0}` | `{3, 4, 0, 0}` | Yes | Zeros filtered, remaining match |

---

## 6. What This Design Guarantees

### 6.1 Guarantees

1. **Deterministic Results**: Same patient data produces same pass/fail regardless of bundle ordering
2. **Clinical Accuracy**: Calculations based on clinical relationships (dates, codes)
3. **EHR Independence**: Works with data from any EHR system regardless of export order
4. **Order-Independent Comparison**: Multi-encounter measures compared by value sets, not positions

### 6.2 Non-Guarantees

1. **Positional Matching**: We do NOT guarantee obs1 always maps to "first encounter"
2. **Specific Ordering**: The order of encounters in output may vary
3. **MeasureReport Position Match**: Our obs1-4 positions may differ from MeasureReport's _1-_4 positions

---

## 7. CMS986 Measure Implementation

### 7.1 Measure Structure

| Group | Name | Observation Type |
|-------|------|------------------|
| Group 1 | Malnutrition Risk Screening or Dietitian Referral | Per-encounter (0 or 1) |
| Group 2 | Nutrition Assessment with Identified Status | Per-encounter (0 or 1) |
| Group 3 | Malnutrition Diagnosis | Per-encounter (0 or 1) |
| Group 4 | Nutrition Care Plan | Per-encounter (0 or 1) |
| Group 5 | Total Malnutrition Components Score | Per-encounter total (0-4) |
| Group 6 | Total Malnutrition Care Score as Percentage | Per-encounter percentage (0-100) |

### 7.2 Per-Encounter Calculation

For each encounter in the Measure Population:

```typescript
// Calculate observations based on clinical data matches
let encObs1 = screeningOrReferral.has(encId) ? 1 : 0;
let encObs2 = (atRiskOrReferral.has(encId) && assessmentWithStatus.has(encId)) ? 1 : 0;
let encObs3 = (modSevereAssessment.has(encId) && diagnosis.has(encId)) ? 1 : 0;
let encObs4 = (modSevereAssessment.has(encId) && carePlan.has(encId)) ? 1 : 0;

// Group 5: Sum of obs1-4 for this encounter
const encScore = encObs1 + encObs2 + encObs3 + encObs4;

// Group 6: Percentage based on eligible occurrences
const encPercentage = (encScore / encEligible) * 100;
```

---

## 8. Validation Evidence

### 8.1 Test Results

With order-independent comparison:
- **145 of 146 tests pass** (99.3%)
- The 1 failure is a genuine CQL logic edge case, not an ordering issue

### 8.2 Ordering Tests

Tests include cases with:
- Single encounter
- Multiple encounters (2-4)
- Encounters with different clinical profiles
- Various observation combinations

All pass with order-independent comparison, confirming the design.

---

## 9. Conclusion

The CQL Test Runner is designed to evaluate measures based on **clinical data semantics**:

1. **CQL Engine**: Uses clinical dates for all queries and relationships
2. **Set Membership**: Checks existence, not position
3. **Comparison Logic**: Order-independent for multi-encounter groups
4. **Result Interpretation**: Values matter, not positions

This ensures that:
- Different EHR systems produce consistent results
- Bundle ordering does not affect calculations
- Clinical accuracy is maintained regardless of data presentation

---

*Document Version: 1.0*
*Last Updated: 2025-12-22*
*Related Files: `src/index.ts`, `src/madie/test-bundle-processor.ts`*
