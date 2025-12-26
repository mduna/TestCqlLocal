/**
 * Test Bundle Processor for MADiE Test Cases
 *
 * Processes MADiE-exported test case bundles:
 * - Parses README.txt for test case name mapping
 * - Converts transaction bundles to collection bundles
 * - Extracts expected results from MeasureReport resources
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * FHIR Bundle types
 */
interface FHIRBundle {
  resourceType: 'Bundle';
  id?: string;
  type: 'transaction' | 'collection' | 'batch' | 'searchset';
  entry?: Array<{
    fullUrl?: string;
    resource?: any;
    request?: {
      method: string;
      url: string;
    };
  }>;
}

/**
 * Individual observation values within a group
 * For Groups 1-4: only obs1 is used (the single observation for that group)
 * For Group 5-6: obs1-obs4 represent the individual observation totals
 */
export interface ObservationValues {
  obs1: number;
  obs2: number;
  obs3: number;
  obs4: number;
}

/**
 * Population counts within a group
 */
export interface PopulationCounts {
  initialPopulation: number;
  measurePopulation: number;
  measurePopulationExclusion: number;
  observations: ObservationValues;  // Individual observation values
}

/**
 * Group-level expected results
 */
export interface ExpectedGroup {
  groupId: string;
  populations: PopulationCounts;
  measureScore: number;
}

/**
 * Expected results extracted from MeasureReport
 */
export interface ExpectedResults {
  patientId: string;
  measurementPeriod: {
    start: string;
    end: string;
  };
  populations: Array<{
    code: string;
    count: number;
  }>;
  groups: ExpectedGroup[];
  measureScore?: number;
  description?: string;
}

/**
 * Test case structure
 */
export interface TestCase {
  id: string;           // UUID folder name
  name: string;         // Human-readable name from README.txt (group name)
  fileName: string;     // Original file name (contains group + unique test case name)
  patientBundle: FHIRBundle;
  expectedResults: ExpectedResults;
}

/**
 * Parse README.txt to get UUID to test name mapping.
 *
 * @param readmePath - Path to README.txt
 * @returns Map of UUID to test name
 */
export function parseReadmeMapping(readmePath: string): Map<string, string> {
  const mapping = new Map<string, string>();

  if (!fs.existsSync(readmePath)) {
    return mapping;
  }

  const content = fs.readFileSync(readmePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    // Format: "Case # N - UUID =  TestName"
    const match = line.match(/Case #\s*\d+\s*-\s*([a-f0-9-]+)\s*=\s*(\S+)/i);
    if (match) {
      const uuid = match[1].trim();
      const name = match[2].trim();
      mapping.set(uuid, name);
    }
  }

  return mapping;
}

/**
 * Convert a bundle to a collection bundle for CQL execution.
 * Handles both transaction and collection bundle types.
 * Removes request objects (if present) and excludes MeasureReport.
 *
 * @param bundle - The input bundle (transaction or collection)
 * @returns Collection bundle with only resources (excluding MeasureReport)
 */
export function convertToCollectionBundle(bundle: FHIRBundle): FHIRBundle {
  const collectionBundle: FHIRBundle = {
    resourceType: 'Bundle',
    id: bundle.id,
    type: 'collection',
    entry: []
  };

  if (bundle.entry) {
    for (const entry of bundle.entry) {
      if (entry.resource) {
        // Skip MeasureReport - we extract it separately
        if (entry.resource.resourceType === 'MeasureReport') {
          continue;
        }

        // Add entry without request object (works for both transaction and collection)
        collectionBundle.entry!.push({
          fullUrl: entry.fullUrl,
          resource: entry.resource
        });
      }
    }
  }

  return collectionBundle;
}

/**
 * Extract expected results from MeasureReport in the bundle.
 *
 * @param bundle - The test case bundle
 * @returns Expected results
 */
export function extractExpectedResults(bundle: FHIRBundle): ExpectedResults {
  // Find MeasureReport resource
  let measureReport: any = null;

  if (bundle.entry) {
    for (const entry of bundle.entry) {
      if (entry.resource?.resourceType === 'MeasureReport') {
        measureReport = entry.resource;
        break;
      }
    }
  }

  if (!measureReport) {
    throw new Error('No MeasureReport found in test case bundle');
  }

  // Extract patient ID from contained parameters or subject reference
  let patientId = '';
  if (measureReport.contained) {
    for (const contained of measureReport.contained) {
      if (contained.resourceType === 'Parameters') {
        const subjectParam = contained.parameter?.find((p: any) => p.name === 'subject');
        if (subjectParam?.valueString) {
          patientId = subjectParam.valueString;
        }
      }
    }
  }

  // Extract measurement period
  const measurementPeriod = {
    start: measureReport.period?.start || '2025-01-01',
    end: measureReport.period?.end || '2025-01-31'
  };

  // Extract populations from groups (legacy flat format)
  const populations: Array<{ code: string; count: number }> = [];

  // Extract groups with structured population counts
  const groups: ExpectedGroup[] = [];

  if (measureReport.group) {
    for (const group of measureReport.group) {
      // Legacy flat populations
      if (group.population) {
        for (const pop of group.population) {
          const code = pop.code?.coding?.[0]?.code;
          const count = pop.count ?? 0;
          if (code) {
            populations.push({ code, count });
          }
        }
      }

      // Structured group extraction
      const groupId = group.id || `Group_${groups.length + 1}`;
      const groupPops: PopulationCounts = {
        initialPopulation: 0,
        measurePopulation: 0,
        measurePopulationExclusion: 0,
        observations: { obs1: 0, obs2: 0, obs3: 0, obs4: 0 }
      };

      if (group.population) {
        for (const pop of group.population) {
          const code = pop.code?.coding?.[0]?.code;
          const count = pop.count ?? 0;
          const popId = pop.id || '';

          switch (code) {
            case 'initial-population':
              groupPops.initialPopulation = count;
              break;
            case 'measure-population':
              groupPops.measurePopulation = count;
              break;
            case 'measure-population-exclusion':
              groupPops.measurePopulationExclusion = count;
              break;
            case 'measure-population-observation':
            case 'measure-observation':
              // Parse observation index from id: "MeasureObservation_N_X" where X is 1-4
              // For Groups 1-4: id is like "MeasureObservation_1_1", "MeasureObservation_1_2" (encounter-level)
              // For Groups 5-6: id is like "MeasureObservation_5_1" (obs1), "MeasureObservation_5_2" (obs2)
              const obsMatch = popId.match(/MeasureObservation_\d+_(\d+)/);
              if (obsMatch) {
                const obsIndex = parseInt(obsMatch[1], 10);
                // For Groups 1-4, all observations go to obs1 (sum of per-encounter values)
                // For Groups 5-6, observations map to obs1-4
                if (groupId === 'Group_5' || groupId === 'Group_6') {
                  // Direct mapping: MeasureObservation_5_1 -> obs1, _5_2 -> obs2, etc.
                  switch (obsIndex) {
                    case 1: groupPops.observations.obs1 = count; break;
                    case 2: groupPops.observations.obs2 = count; break;
                    case 3: groupPops.observations.obs3 = count; break;
                    case 4: groupPops.observations.obs4 = count; break;
                  }
                } else {
                  // Groups 1-4: sum all observations into obs1
                  groupPops.observations.obs1 += count;
                }
              } else {
                // Fallback: sum into obs1
                groupPops.observations.obs1 += count;
              }
              break;
          }
        }
      }

      groups.push({
        groupId,
        populations: groupPops,
        measureScore: group.measureScore?.value ?? 0
      });
    }
  }

  // Extract measure score (first group)
  let measureScore: number | undefined;
  if (measureReport.group?.[0]?.measureScore?.value !== undefined) {
    measureScore = measureReport.group[0].measureScore.value;
  }

  // Extract description from extension
  let description: string | undefined;
  if (measureReport.extension) {
    for (const ext of measureReport.extension) {
      if (ext.url?.includes('testCaseDescription') && ext.valueMarkdown) {
        description = ext.valueMarkdown;
        break;
      }
    }
  }

  return {
    patientId,
    measurementPeriod,
    populations,
    groups,
    measureScore,
    description
  };
}

/**
 * Load a single test case from a directory.
 *
 * @param testCaseDir - Path to the test case directory (UUID folder)
 * @param testName - Human-readable test name
 * @returns The test case
 */
export function loadTestCase(testCaseDir: string, testName: string): TestCase {
  const uuid = path.basename(testCaseDir);

  // Find the JSON file in the directory
  const files = fs.readdirSync(testCaseDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    throw new Error(`No JSON file found in ${testCaseDir}`);
  }

  const originalFileName = files[0];
  const bundlePath = path.join(testCaseDir, originalFileName);
  const content = fs.readFileSync(bundlePath, 'utf-8');
  const bundle: FHIRBundle = JSON.parse(content);

  // Extract expected results before converting
  const expectedResults = extractExpectedResults(bundle);

  // Convert to collection bundle (removes MeasureReport)
  const patientBundle = convertToCollectionBundle(bundle);

  // Extract unique test case name from filename
  // Format: {Package}-{Group}-{TestCaseName}.json
  // e.g., CMS986FHIR-v1.0.000-MSROBSPass4-2EncountersScreAtRiskThenRef.json
  const fileNameWithoutExt = originalFileName.replace('.json', '');

  return {
    id: uuid,
    name: testName,
    fileName: fileNameWithoutExt,
    patientBundle,
    expectedResults
  };
}

/**
 * Load all test cases from a test cases directory.
 *
 * @param testCasesDir - Path to the test cases directory
 * @returns Array of test cases
 */
export function loadTestCases(testCasesDir: string): TestCase[] {
  if (!fs.existsSync(testCasesDir)) {
    throw new Error(`Test cases directory not found: ${testCasesDir}`);
  }

  // Parse README.txt for name mapping
  const readmePath = path.join(testCasesDir, 'README.txt');
  const nameMapping = parseReadmeMapping(readmePath);

  // Get all UUID directories
  const entries = fs.readdirSync(testCasesDir, { withFileTypes: true });
  const testCases: TestCase[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Check if it looks like a UUID
    const uuid = entry.name;
    if (!/^[a-f0-9-]{36}$/i.test(uuid)) continue;

    const testName = nameMapping.get(uuid) || uuid;
    const testCaseDir = path.join(testCasesDir, uuid);

    try {
      const testCase = loadTestCase(testCaseDir, testName);
      testCases.push(testCase);
    } catch (err) {
      console.warn(`Warning: Could not load test case ${testName}:`, err);
    }
  }

  // Sort by name for consistent ordering
  testCases.sort((a, b) => a.name.localeCompare(b.name));

  return testCases;
}

/**
 * Get patient ID from a bundle.
 *
 * @param bundle - The FHIR bundle
 * @returns Patient ID or undefined
 */
export function getPatientIdFromBundle(bundle: FHIRBundle): string | undefined {
  if (!bundle.entry) return undefined;

  for (const entry of bundle.entry) {
    if (entry.resource?.resourceType === 'Patient') {
      return entry.resource.id;
    }
  }

  return undefined;
}
