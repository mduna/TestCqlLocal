# CQL Local Testing App

A CLI tool for testing CQL (Clinical Quality Language) measures locally, specifically designed for testing MADiE-exported CQL packages with QI-Core 6.0.0 profiles.

## Prerequisites

- Node.js 18 or higher
- npm
- Python 3 (for downloading ValueSets from VSAC)
- VSAC API Key (get one at https://uts.nlm.nih.gov/uts/)

## Installation

```bash
cd TestCqlLocal
npm install
```

## Quick Start

### 1. Download ValueSets from VSAC

First, encode your VSAC API key:
```bash
# Linux/Mac
echo -n "apikey:YOUR-VSAC-KEY" | base64

# Or use Python
python -c "import base64; print(base64.b64encode(b'apikey:YOUR-VSAC-KEY').decode())"
```

Then download the required ValueSets:
```bash
python scripts/download-valuesets.py --api-key "YOUR_BASE64_KEY" --package NHSNACHMonthly1-v0.0.000-FHIR
```

### 2. Run Test Cases

Run all 30 test cases:
```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases
```

Run a specific test:
```bash
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --test HOBPositiveDay4SAureus
```

### Expected Output

```
MADiE Package Test Runner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Package: NHSNAcuteCareHospitalMonthlyInitialPopulation1
Libraries: 5

[PASS] HOBPositiveDay4SAureus
  Initial Population: expected 1, got 1

[PASS] OrganDysfunctionCardiovascularVasopressor
  Initial Population: expected 1, got 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Results: 30 passed, 0 failed
```

## MADiE Command Reference

```bash
npx tsx src/index.ts madie <package-dir> [options]

Options:
  --test-cases <dir>    Test cases directory (required)
  --test <name>         Run specific test by name
  --valuesets <dir>     ValueSets directory (default: valuesets/nhsn)
  --library <name>      Specify main library name (auto-detected)
  --json                Output results as JSON to console
  --verbose             Show detailed execution info
  --full                Include all expression results (SDEs) in JSON
  --output <file>       Save results to file (JSON format)
  --save-elm <dir>      Save extracted ELM files to directory
  --save-bundles <dir>  Save processed patient bundles to directory
```

### Examples

```bash
# Run all tests
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases

# Run specific test with verbose output
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --test HOBPositiveDay4SAureus --verbose

# Get JSON output with full SDE data
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --test HOBPositiveDay4SAureus --json --full

# Save results to file
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --json > results.json
```

## Testing Multiple CQL Packages

Each MADiE package can have its own valueset subdirectory, allowing independent testing:

```
TestCqlLocal/
├── valuesets/
│   ├── nhsn/                    # ValueSets for NHSN measure
│   ├── diabetes/                # ValueSets for diabetes measure
│   └── hypertension/            # ValueSets for hypertension measure
├── NHSNACHMonthly1-v0.0.000-FHIR/
├── DiabetesMeasure-v1.0.000-FHIR/
└── HypertensionMeasure-v2.0.000-FHIR/
```

### Step 1: Download ValueSets for Each Package

```bash
# For NHSN measure (default)
python scripts/download-valuesets.py \
  --api-key "YOUR_KEY" \
  --package NHSNACHMonthly1-v0.0.000-FHIR \
  --output valuesets/nhsn

# For a diabetes measure
python scripts/download-valuesets.py \
  --api-key "YOUR_KEY" \
  --package DiabetesMeasure-v1.0.000-FHIR \
  --output valuesets/diabetes

# For a hypertension measure
python scripts/download-valuesets.py \
  --api-key "YOUR_KEY" \
  --package HypertensionMeasure-v2.0.000-FHIR \
  --output valuesets/hypertension
```

### Step 2: Run Tests with Correct ValueSet Directory

```bash
# Test NHSN measure
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --valuesets valuesets/nhsn

# Test diabetes measure
npx tsx src/index.ts madie DiabetesMeasure-v1.0.000-FHIR \
  --test-cases DiabetesMeasure-v1.0.000-FHIR-TestCases \
  --valuesets valuesets/diabetes

# Test hypertension measure
npx tsx src/index.ts madie HypertensionMeasure-v2.0.000-FHIR \
  --test-cases HypertensionMeasure-v2.0.000-FHIR-TestCases \
  --valuesets valuesets/hypertension
```

Each package uses its own isolated set of ValueSets, so there is no interference between different measures.

### Step 3: Save Results to Isolated Directories

Use `--output` to save test results to separate files for each package:

```
TestCqlLocal/
├── results/
│   ├── nhsn/
│   │   ├── 2025-01-15-run1.json
│   │   └── 2025-01-16-run2.json
│   ├── diabetes/
│   │   └── 2025-01-15-run1.json
│   └── hypertension/
│       └── 2025-01-15-run1.json
```

```bash
# Save NHSN results
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --valuesets valuesets/nhsn \
  --output results/nhsn/2025-01-15-run1.json

# Save diabetes results with full SDE data
npx tsx src/index.ts madie DiabetesMeasure-v1.0.000-FHIR \
  --test-cases DiabetesMeasure-v1.0.000-FHIR-TestCases \
  --valuesets valuesets/diabetes \
  --output results/diabetes/2025-01-15-run1.json \
  --full
```

The `--output` option:
- Creates directories automatically if they don't exist
- Saves results in JSON format with timestamp
- Can be combined with `--full` to include all SDE expressions

### Step 4: Save Intermediate Outputs (Optional)

Save extracted ELM and processed bundles for debugging or reuse:

```
TestCqlLocal/
├── elm-output/
│   └── nhsn/
│       ├── NHSNAcuteCareHospitalMonthlyInitialPopulation1-0.0.000.json
│       ├── FHIRHelpers-4.4.000.json
│       ├── QICoreCommon-4.0.000.json
│       ├── CQMCommon-4.1.000.json
│       └── SharedResourceCreation-0.1.000.json
├── bundles-output/
│   └── nhsn/
│       ├── HOBPositiveDay4SAureus-bundle.json
│       └── OrganDysfunctionCardiovascularVasopressor-bundle.json
└── results/
    └── nhsn/
        └── 2025-01-15-run1.json
```

```bash
# Save all intermediate outputs
npx tsx src/index.ts madie NHSNACHMonthly1-v0.0.000-FHIR \
  --test-cases NHSNACHMonthly1-v0.0.000-FHIR-TestCases \
  --valuesets valuesets/nhsn \
  --save-elm elm-output/nhsn \
  --save-bundles bundles-output/nhsn \
  --output results/nhsn/2025-01-15-run1.json \
  --full
```

**What gets saved:**

| Option | Content | Use Case |
|--------|---------|----------|
| `--save-elm` | Extracted ELM JSON (decoded from base64) | Debug CQL logic, share with others |
| `--save-bundles` | Clean FHIR collection bundles (MeasureReport removed) | Share with others for independent measure execution |
| `--output` | Test results with pass/fail | Track test history, CI/CD integration |

**Bundle Naming:** Saved bundles use the original test case filename which contains the package, group, and unique test case name:
```
{Package}-{Group}-{TestCaseName}-bundle.json
```
Examples:
- `CMS986FHIR-v1.0.000-MSROBSPass4-2EncountersScreAtRiskThenRef-bundle.json`
- `NHSNACHMonthly1-v0.0.000-AROptionAR1_HospitalOnsetMRSA-bundle.json`

**Note:** All saved files will be overwritten if they already exist. Use unique filenames or directories to preserve previous outputs.

**Bundle Format Support:** Test case bundles can be in either **transaction** or **collection** format. The tool automatically handles both formats.

## How It Works

1. **Load MADiE Package**: Extracts ELM from FHIR Library resources (base64-encoded in `resources/library-*.json`)

2. **Build Repository**: Combines the main library with dependent libraries:
   - FHIRHelpers 4.4.000
   - QICoreCommon 4.0.000
   - CQMCommon 4.1.000
   - SharedResourceCreation 0.1.000

3. **Load ValueSets**: Creates CodeService from downloaded VSAC ValueSets

4. **Process Test Cases**:
   - Reads test bundles from UUID-named folders
   - Handles both transaction and collection bundle formats
   - Extracts expected results from MeasureReport

5. **Execute CQL**: Runs against each patient and compares Initial Population count

## Execution Path

```
CLI Command: npx tsx src/index.ts madie <package> --test-cases <dir>
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Load MADiE Package (src/madie/package-loader.ts)         │
│    ├── Extract ELM from FHIR Library (elm-extractor.ts)     │
│    │   └── Decode base64 content from library-*.json        │
│    └── Build Repository with all libraries                  │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Load ValueSets (src/madie/valueset-loader.ts)            │
│    ├── Read JSON files from valuesets/nhsn/                 │
│    └── Create CodeService for terminology resolution        │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Process Test Cases (src/madie/test-bundle-processor.ts)  │
│    ├── Read README.txt for UUID → test name mapping         │
│    ├── Load test bundle from each UUID folder               │
│    ├── Handle transaction or collection bundle format       │
│    └── Extract expected results from MeasureReport          │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Execute CQL (src/engine/cql-runner.ts)                   │
│    ├── Create PatientSource from test bundle                │
│    ├── Create Executor with Library + CodeService           │
│    ├── Run: await executor.exec(patientSource)              │
│    └── Get: results.patientResults[patientId]               │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Compare Results                                          │
│    ├── Count "Initial Population" array length              │
│    ├── Compare with expected count from MeasureReport       │
│    └── Report PASS/FAIL                                     │
└─────────────────────────────────────────────────────────────┘
```

## Key Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry point, `madie` command handler |
| `src/madie/elm-extractor.ts` | Decode base64 ELM from FHIR Library resources |
| `src/madie/package-loader.ts` | Load all libraries, build cql-execution Repository |
| `src/madie/test-bundle-processor.ts` | Parse test bundles, extract expected results |
| `src/madie/valueset-loader.ts` | Load VSAC ValueSets into CodeService |
| `src/engine/cql-runner.ts` | Core CQL execution wrapper |
| `src/engine/patient-source.ts` | FHIR bundle to PatientSource conversion |
| `src/terminology/valueset-loader.ts` | Base ValueSet/CodeService utilities |

## Project Structure

```
TestCqlLocal/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── engine/                  # CQL execution engine
│   ├── madie/                   # MADiE package handling
│   └── terminology/             # ValueSet/CodeService
├── scripts/
│   ├── download-valuesets.py    # VSAC download script
│   ├── vsac_client.py           # VSAC API client
│   └── code_systems.py          # Code system definitions
├── valuesets/nhsn/              # Downloaded ValueSets (8 files)
├── NHSNACHMonthly1-v0.0.000-FHIR/           # MADiE package
│   ├── resources/               # FHIR Library resources
│   └── cql/                     # CQL source files
└── NHSNACHMonthly1-v0.0.000-FHIR-TestCases/ # 30 test cases
    ├── README.txt               # UUID to test name mapping
    └── {uuid}/                  # Individual test bundles
```

## Troubleshooting

### "ValueSet directory not found"
- Run the download script first:
  ```bash
  python scripts/download-valuesets.py --api-key "KEY" --package NHSNACHMonthly1-v0.0.000-FHIR
  ```

### "Main library not found"
- Specify the library name explicitly:
  ```bash
  --library NHSNAcuteCareHospitalMonthlyInitialPopulation1
  ```

### "Test case not found"
- Check available test names in `NHSNACHMonthly1-v0.0.000-FHIR-TestCases/README.txt`
- Test names are case-sensitive

### VSAC API errors
- Ensure your API key is base64-encoded correctly
- Format: `apikey:YOUR-KEY` encoded as base64
- Check your VSAC account has API access enabled

## Resources

- [QI-Core 6.0.0 IG](https://hl7.org/fhir/us/qicore/STU6/)
- [CQL Specification](https://cql.hl7.org/)
- [FHIR R4](https://hl7.org/fhir/R4/)
- [MADiE](https://madie.cms.gov/) - Measure Authoring Development Integrated Environment
- [VSAC](https://vsac.nlm.nih.gov/) - Value Set Authority Center
- [cql-execution](https://github.com/cqframework/cql-execution)
- [cql-exec-fhir](https://github.com/cqframework/cql-exec-fhir)
