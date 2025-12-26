# CQL Local Testing - Command Prompts

## Command Template

```bash
npx tsx src/index.ts madie <package-dir> \
  --test-cases <test-cases-dir> \
  [--valuesets <valuesets-dir>] \
  [--test <test-name>] \
  [--library <library-name>] \
  [--output <results-file>] \
  [--save-elm <elm-dir>] \
  [--save-bundles <bundles-dir>] \
  [--json] \
  [--verbose] \
  [--full]
```

## Options Reference

| Option | Required | Description |
|--------|----------|-------------|
| `<package-dir>` | Yes | MADiE package directory (e.g., `NHSNACHMonthly1-v0.0.000-FHIR`) |
| `--test-cases <dir>` | Yes | Test cases directory |
| `--valuesets <dir>` | No | ValueSets directory (default: `valuesets/nhsn`) |
| `--test <name>` | No | Run specific test by name |
| `--library <name>` | No | Main library name (auto-detected) |
| `--output <file>` | No | Save results to JSON file |
| `--save-elm <dir>` | No | Save extracted ELM files |
| `--save-bundles <dir>` | No | Save processed patient bundles |
| `--json` | No | Output results as JSON to console |
| `--verbose` | No | Show detailed execution info |
| `--full` | No | Include all SDE expressions in output |

---

## Example Prompts

### 1. Basic Test Run

Run all test cases with default settings:

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases
```

### 2. Run with Custom ValueSets

Specify a custom valuesets directory:

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --valuesets valuesets/nhsn
```

### 3. Run Single Test

Run a specific test case by name:

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --test HOBPositiveDay4SAureus
```

### 4. Save Results to File

Save test results to a JSON file:

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --valuesets valuesets/nhsn \
  --output results/nhsn/2025-12-26-run1.json
```

### 5. Full Run with All Outputs

Save results with full SDE data:

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --valuesets valuesets/nhsn \
  --output results/nhsn/2025-12-26-run1.json \
  --full
```

### 6. Save All Intermediate Outputs

Save ELM, bundles, and results for debugging or sharing:

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --valuesets valuesets/nhsn \
  --save-elm elm-output/nhsn \
  --save-bundles bundles-output/nhsn \
  --output results/nhsn/2025-12-26-run1.json \
  --full
```

### 7. JSON Output to Console

Get JSON output directly in console:

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --json
```

### 8. Verbose Mode for Debugging

Run with detailed execution info:

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --verbose
```

---

## Workflow Examples

### Complete Workflow for a New Package

```bash
# Step 1: Download ValueSets from VSAC
python scripts/download-valuesets.py \
  --package MyMeasure-v1.0.000-FHIR \
  --output valuesets/mymeasure

# Step 2: Run tests and save results
npx tsx src/index.ts madie MyMeasure-v1.0.000-FHIR \
  --test-cases MyMeasure-v1.0.000-FHIR-TestCases \
  --valuesets valuesets/mymeasure \
  --output results/mymeasure/2025-12-26-run1.json

# Step 3: Run with full output for analysis
npx tsx src/index.ts madie MyMeasure-v1.0.000-FHIR \
  --test-cases MyMeasure-v1.0.000-FHIR-TestCases \
  --valuesets valuesets/mymeasure \
  --output results/mymeasure/2025-12-26-full.json \
  --full
```

### CMS986 Measure Example

```bash
npx tsx src/index.ts madie CMS986FHIR-v1.0.000-FHIR \
  --test-cases CMS986FHIR-v1.0.000-FHIR-TestCases \
  --valuesets valuesets/cms986 \
  --output results/cms986/2025-12-26-run1.json \
  --full
```

### NHSN Measure Example

```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --valuesets valuesets/nhsn \
  --output results/nhsn/2025-12-26-run1.json \
  --full
```

---

## Output Structure

### Console Output

```
MADiE Package Test Runner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Package: NHSNAcuteCareHospitalMonthlyInitialPopulation1
Libraries: 5

[PASS] TestCase1
  Initial Population: expected 1, got 1

[FAIL] TestCase2
  Initial Population: expected 1, got 0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Results: 29 passed, 1 failed
```

### JSON Output Structure

```json
{
  "package": "MeasureName",
  "timestamp": "2025-12-26T12:00:00.000Z",
  "total": 17,
  "passed": 17,
  "failed": 0,
  "results": [
    {
      "name": "TestCaseName",
      "passed": true,
      "expected": 1,
      "actual": 1,
      "groups": [...],
      "expressions": {...}
    }
  ]
}
```

---

## Notes

- Test case bundles can be in either **transaction** or **collection** format
- MeasureReport is automatically extracted for expected results
- ValueSets must be downloaded from VSAC before running tests
- Use `--full` to include all Supplemental Data Elements (SDEs) in output
