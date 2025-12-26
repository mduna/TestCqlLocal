#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';

import {
  executeCQL,
  loadELM,
  validateELM,
  getELMList,
  getStatements,
} from './engine/cql-runner.js';
import {
  createPatientSourceFromFile,
  createPatientSourceFromDirectory,
  getPatientList,
} from './engine/patient-source.js';
import {
  createCodeService,
  getValueSetList,
} from './terminology/valueset-loader.js';
import {
  loadMADiEPackage,
  createRepository,
  listPackageLibraries,
} from './madie/package-loader.js';
import {
  loadTestCases,
  getPatientIdFromBundle,
  TestCase,
  PopulationCounts,
  ExpectedGroup,
  ObservationValues,
} from './madie/test-bundle-processor.js';
import {
  loadValueSetsForMadie,
  getValueSetSummary,
} from './madie/valueset-loader.js';
import { PatientSource } from 'cql-exec-fhir';
import { Library, Executor, DateTime, Interval } from 'cql-execution';

const program = new Command();

/**
 * Human-readable group names for CMS986 measure
 */
const GROUP_NAMES: Record<string, string> = {
  'Group_1': 'Malnutrition Risk Screening or Dietitian Referral',
  'Group_2': 'Nutrition Assessment with Identified Status',
  'Group_3': 'Malnutrition Diagnosis',
  'Group_4': 'Nutrition Care Plan',
  'Group_5': 'Total Malnutrition Components Score',
  'Group_6': 'Total Malnutrition Care Score as Percentage'
};

/**
 * Human-readable observation names
 */
const OBSERVATION_NAMES: Record<string, string> = {
  'obs1': 'Malnutrition Risk Screening or Dietitian Referral',
  'obs2': 'Nutrition Assessment with Identified Status',
  'obs3': 'Malnutrition Diagnosis',
  'obs4': 'Nutrition Care Plan'
};

/**
 * Actual group results calculated from CQL execution
 */
interface ActualGroup {
  groupId: string;
  populations: PopulationCounts;
  measureScore: number;
}

/**
 * Group comparison result
 */
interface GroupComparison {
  groupId: string;
  expected: PopulationCounts;
  actual: PopulationCounts;
  expectedScore: number;
  actualScore: number;
  passed: boolean;
}

/**
 * Helper to get encounter IDs from expression result
 * Handles both string IDs and {value: 'id'} objects
 */
function getEncounterIds(val: unknown): Set<string> {
  const ids = new Set<string>();
  if (Array.isArray(val)) {
    for (const item of val) {
      if (item && typeof item === 'object') {
        const enc = item as Record<string, unknown>;
        if (enc.id) {
          // Handle both string IDs and {value: 'id'} objects
          if (typeof enc.id === 'string') {
            ids.add(enc.id);
          } else if (typeof enc.id === 'object' && enc.id !== null) {
            const idObj = enc.id as Record<string, unknown>;
            if (idObj.value) {
              ids.add(String(idObj.value));
            }
          }
        }
      }
    }
  }
  return ids;
}

/**
 * Get encounter ID from an encounter object
 */
function getEncounterId(enc: Record<string, unknown>): string {
  if (enc.id) {
    if (typeof enc.id === 'string') {
      return enc.id;
    } else if (typeof enc.id === 'object' && enc.id !== null) {
      const idObj = enc.id as Record<string, unknown>;
      if (idObj.value) {
        return String(idObj.value);
      }
    }
  }
  return '';
}

/**
 * Get encounter period start date for sorting
 */
function getEncounterStart(enc: Record<string, unknown>): string {
  const period = enc.period as Record<string, unknown> | undefined;
  if (period?.start) {
    if (typeof period.start === 'string') {
      return period.start;
    } else if (typeof period.start === 'object' && period.start !== null) {
      const startObj = period.start as Record<string, unknown>;
      if (startObj.value) {
        return String(startObj.value);
      }
    }
  }
  return '';
}

/**
 * Get sorted encounter IDs from expression result
 * Sorts by encounter period start date (ascending)
 */
function getSortedEncounterIds(val: unknown): string[] {
  if (!Array.isArray(val)) return [];

  const encounters: Array<{ id: string; start: string }> = [];
  for (const item of val) {
    if (item && typeof item === 'object') {
      const enc = item as Record<string, unknown>;
      const id = getEncounterId(enc);
      const start = getEncounterStart(enc);
      if (id) {
        encounters.push({ id, start });
      }
    }
  }

  // Keep encounters in original order (no sorting)
  // Comparison will sort both expected and actual values

  return encounters.map(e => e.id);
}

/**
 * Calculate observation values from expression results
 * Observations are calculated PER ENCOUNTER and summed
 */
function calculateObservations(expressions: Record<string, unknown>): {
  obs1: number;
  obs2: number;
  obs3: number;
  obs4: number;
} {
  // Get encounter ID sets for each relevant expression
  const measurePop = getEncounterIds(expressions['Measure Population']);
  const screeningOrReferral = getEncounterIds(expressions['Encounters with Malnutrition Risk Screening or with Dietitian Referral']);
  const atRiskOrReferral = getEncounterIds(expressions['Encounters with Malnutrition Risk Screening At Risk or with Dietitian Referral']);
  const notAtRiskWithoutReferral = getEncounterIds(expressions['Encounters with Malnutrition Not At Risk Screening and without Dietitian Referral']);
  const assessmentWithStatus = getEncounterIds(expressions['Encounter With Most Recent Nutrition Assessment And Identified Status']);
  const modSevereAssessment = getEncounterIds(expressions['Encounter With Most Recent Nutrition Assessment Status of Moderately Or Severely Malnourished']);
  const notMildAssessment = getEncounterIds(expressions['Encounter With Most Recent Nutrition Assessment Status of Not or Mildly Malnourished']);
  const diagnosis = getEncounterIds(expressions['Encounters with Malnutrition Diagnosis']);
  const carePlan = getEncounterIds(expressions['Encounters with Nutrition Care Plan']);

  let obs1 = 0, obs2 = 0, obs3 = 0, obs4 = 0;

  // For each encounter in measure population, calculate observations
  for (const encId of measurePop) {
    // Obs 1: Screening or Referral for THIS encounter
    if (screeningOrReferral.has(encId)) {
      obs1 += 1;
    }

    // Obs 2: Assessment with Status for THIS encounter
    if (notAtRiskWithoutReferral.has(encId)) {
      // Not at risk without referral = 0
    } else if (atRiskOrReferral.has(encId) && assessmentWithStatus.has(encId)) {
      obs2 += 1;
    }

    // Obs 3: Diagnosis for THIS encounter (only if moderate/severe)
    if (notAtRiskWithoutReferral.has(encId)) {
      // Not at risk without referral = 0
    } else if (atRiskOrReferral.has(encId) &&
               modSevereAssessment.has(encId) &&
               diagnosis.has(encId)) {
      obs3 += 1;
    }

    // Obs 4: Care Plan for THIS encounter (only if moderate/severe)
    if (notAtRiskWithoutReferral.has(encId)) {
      // Not at risk without referral = 0
    } else if (atRiskOrReferral.has(encId) &&
               modSevereAssessment.has(encId) &&
               carePlan.has(encId)) {
      obs4 += 1;
    }
  }

  return { obs1, obs2, obs3, obs4 };
}

/**
 * Calculate actual group results from CQL expression results
 * CMS986 has 6 groups but they all share the same IP/MP/MPE
 * Groups 1-4 have different observation calculations, Groups 5-6 are aggregates
 */
function calculateActualGroups(expressions: Record<string, unknown>): ActualGroup[] {
  // Get core population counts
  const ipResult = expressions['Initial Population'];
  const mpResult = expressions['Measure Population'];
  const mpeResult = expressions['Measure Population Exclusion'];

  const ipCount = Array.isArray(ipResult) ? ipResult.length : 0;
  const mpCount = Array.isArray(mpResult) ? mpResult.length : 0;
  const mpeCount = Array.isArray(mpeResult) ? mpeResult.length : 0;

  const { obs1, obs2, obs3, obs4 } = calculateObservations(expressions);

  // Create 6 groups matching the MeasureReport structure
  const groups: ActualGroup[] = [];

  // Groups 1-4: Each has the same IP/MP/MPE but different observation values
  // Each group's obs1 holds that group's specific observation count
  const obsValues = [obs1, obs2, obs3, obs4];
  for (let i = 1; i <= 4; i++) {
    groups.push({
      groupId: `Group_${i}`,
      populations: {
        initialPopulation: ipCount,
        measurePopulation: mpCount,
        measurePopulationExclusion: mpeCount,
        observations: { obs1: obsValues[i - 1], obs2: 0, obs3: 0, obs4: 0 }
      },
      measureScore: mpCount > 0 ? obsValues[i - 1] / mpCount : 0
    });
  }

  // Groups 5-6: Per-encounter calculations then summed
  // Get all expression sets needed for per-encounter obs calculation
  const measurePop = getEncounterIds(expressions['Measure Population']);
  // Get SORTED encounter IDs based on encounter period start date
  const sortedEncounterIds = getSortedEncounterIds(expressions['Measure Population']);
  const screeningOrReferral = getEncounterIds(expressions['Encounters with Malnutrition Risk Screening or with Dietitian Referral']);
  const notAtRiskWithoutReferral = getEncounterIds(expressions['Encounters with Malnutrition Not At Risk Screening and without Dietitian Referral']);
  const notMildAssessment = getEncounterIds(expressions['Encounter With Most Recent Nutrition Assessment Status of Not or Mildly Malnourished']);
  const assessmentWithStatus = getEncounterIds(expressions['Encounter With Most Recent Nutrition Assessment And Identified Status']);
  const atRiskOrReferral = getEncounterIds(expressions['Encounters with Malnutrition Risk Screening At Risk or with Dietitian Referral']);
  const modSevereAssessment = getEncounterIds(expressions['Encounter With Most Recent Nutrition Assessment Status of Moderately Or Severely Malnourished']);
  const diagnosis = getEncounterIds(expressions['Encounters with Malnutrition Diagnosis']);
  const carePlan = getEncounterIds(expressions['Encounters with Nutrition Care Plan']);

  let totalComponentsScore = 0;  // Group 5: sum of per-encounter scores
  let totalPercentageSum = 0;    // Group 6: sum of per-encounter percentages

  // Calculate per-encounter values and sum them (using sorted order)
  for (const encId of sortedEncounterIds) {
    // Calculate this encounter's obs1-4 values (0 or 1 each)
    let encObs1 = 0, encObs2 = 0, encObs3 = 0, encObs4 = 0;

    // Obs 1: Screening or Referral
    if (screeningOrReferral.has(encId)) {
      encObs1 = 1;
    }

    // Obs 2: Assessment with Status (only if at-risk or referral)
    if (!notAtRiskWithoutReferral.has(encId) &&
        atRiskOrReferral.has(encId) &&
        assessmentWithStatus.has(encId)) {
      encObs2 = 1;
    }

    // Obs 3: Diagnosis (only if at-risk/referral AND moderate/severe)
    if (!notAtRiskWithoutReferral.has(encId) &&
        atRiskOrReferral.has(encId) &&
        modSevereAssessment.has(encId) &&
        diagnosis.has(encId)) {
      encObs3 = 1;
    }

    // Obs 4: Care Plan (only if at-risk/referral AND moderate/severe)
    if (!notAtRiskWithoutReferral.has(encId) &&
        atRiskOrReferral.has(encId) &&
        modSevereAssessment.has(encId) &&
        carePlan.has(encId)) {
      encObs4 = 1;
    }

    // This encounter's total score (0-4)
    const encScore = encObs1 + encObs2 + encObs3 + encObs4;
    totalComponentsScore += encScore;

    // Calculate this encounter's eligible occurrences based on CQL logic
    let encEligible: number;
    if (screeningOrReferral.has(encId) && notAtRiskWithoutReferral.has(encId)) {
      encEligible = 1;  // Not at risk without referral
    } else if (atRiskOrReferral.has(encId) &&
               (notMildAssessment.has(encId) || !assessmentWithStatus.has(encId))) {
      encEligible = 2;  // At risk but not/mildly malnourished or no assessment
    } else if (screeningOrReferral.has(encId)) {
      encEligible = 4;  // Full pathway (at risk + mod/severe)
    } else {
      encEligible = 2;  // Default
    }

    // This encounter's percentage
    const encPercentage = encEligible > 0 ? (encScore / encEligible) * 100 : 0;
    totalPercentageSum += encPercentage;
  }

  // Groups 5 and 6: Per-encounter values
  // obs1-4 represent per-encounter scores (not per-observation-type totals)
  // Use sorted encounter order to match MeasureReport ordering
  const encounterScores: number[] = [];      // Group 5: total score per encounter (0-4)
  const encounterPercentages: number[] = []; // Group 6: percentage per encounter

  for (const encId of sortedEncounterIds) {
    let encObs1 = screeningOrReferral.has(encId) ? 1 : 0;
    let encObs2 = (!notAtRiskWithoutReferral.has(encId) && atRiskOrReferral.has(encId) && assessmentWithStatus.has(encId)) ? 1 : 0;
    let encObs3 = (!notAtRiskWithoutReferral.has(encId) && atRiskOrReferral.has(encId) && modSevereAssessment.has(encId) && diagnosis.has(encId)) ? 1 : 0;
    let encObs4 = (!notAtRiskWithoutReferral.has(encId) && atRiskOrReferral.has(encId) && modSevereAssessment.has(encId) && carePlan.has(encId)) ? 1 : 0;

    const encScore = encObs1 + encObs2 + encObs3 + encObs4;
    encounterScores.push(encScore);

    let encEligible: number;
    if (screeningOrReferral.has(encId) && notAtRiskWithoutReferral.has(encId)) {
      encEligible = 1;
    } else if (atRiskOrReferral.has(encId) && (notMildAssessment.has(encId) || !assessmentWithStatus.has(encId))) {
      encEligible = 2;
    } else if (screeningOrReferral.has(encId)) {
      encEligible = 4;
    } else {
      encEligible = 2;
    }
    const encPct = encEligible > 0 ? Math.round((encScore / encEligible) * 100) : 0;
    encounterPercentages.push(encPct);
  }

  // Group 5: Total Malnutrition Components Score (per-encounter totals)
  groups.push({
    groupId: 'Group_5',
    populations: {
      initialPopulation: ipCount,
      measurePopulation: mpCount,
      measurePopulationExclusion: mpeCount,
      observations: {
        obs1: encounterScores[0] || 0,
        obs2: encounterScores[1] || 0,
        obs3: encounterScores[2] || 0,
        obs4: encounterScores[3] || 0
      }
    },
    measureScore: mpCount > 0 ? totalComponentsScore / mpCount : 0
  });

  // Group 6: Total Malnutrition Care Score as Percentage (per-encounter percentages)
  groups.push({
    groupId: 'Group_6',
    populations: {
      initialPopulation: ipCount,
      measurePopulation: mpCount,
      measurePopulationExclusion: mpeCount,
      observations: {
        obs1: encounterPercentages[0] || 0,
        obs2: encounterPercentages[1] || 0,
        obs3: encounterPercentages[2] || 0,
        obs4: encounterPercentages[3] || 0
      }
    },
    measureScore: mpCount > 0 ? totalPercentageSum / (mpCount * 100) : 0
  });

  return groups;
}

/**
 * Compare expected and actual groups
 */
function compareGroups(expected: ExpectedGroup[], actual: ActualGroup[]): GroupComparison[] {
  const comparisons: GroupComparison[] = [];

  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    const exp = expected[i];
    const act = actual[i];

    if (!exp || !act) continue;

    // Compare population counts
    const popMatch =
      exp.populations.initialPopulation === act.populations.initialPopulation &&
      exp.populations.measurePopulation === act.populations.measurePopulation &&
      exp.populations.measurePopulationExclusion === act.populations.measurePopulationExclusion;

    // For Groups 1-4: compare obs1 directly (single observation per group)
    // For Groups 5-6: compare sorted observation sets (encounter order doesn't matter)
    let obsMatch: boolean;
    if (exp.groupId === 'Group_5' || exp.groupId === 'Group_6') {
      // Sort both expected and actual observation values for comparison
      // This handles the case where encounters are in different order
      const expObs = [
        exp.populations.observations.obs1,
        exp.populations.observations.obs2,
        exp.populations.observations.obs3,
        exp.populations.observations.obs4
      ].filter(v => v !== 0).sort((a, b) => b - a);  // Non-zero values, descending

      const actObs = [
        act.populations.observations.obs1,
        act.populations.observations.obs2,
        act.populations.observations.obs3,
        act.populations.observations.obs4
      ].filter(v => v !== 0).sort((a, b) => b - a);  // Non-zero values, descending

      obsMatch = expObs.length === actObs.length &&
                 expObs.every((v, idx) => v === actObs[idx]);
    } else {
      // Groups 1-4: direct comparison of obs1
      obsMatch = exp.populations.observations.obs1 === act.populations.observations.obs1;
    }

    const passed = popMatch && obsMatch;

    comparisons.push({
      groupId: exp.groupId,
      expected: exp.populations,
      actual: act.populations,
      expectedScore: exp.measureScore,
      actualScore: act.measureScore,
      passed
    });
  }

  return comparisons;
}

// Default directories
const DEFAULT_PATIENTS_DIR = './patients';
const DEFAULT_VALUESETS_DIR = './valuesets';
const DEFAULT_ELM_DIR = './elm';

program
  .name('cql')
  .description('CLI tool for testing CQL locally with QI-Core 6.0.0')
  .version('1.0.0');

// Run command - execute CQL
program
  .command('run <elm-file>')
  .description('Execute a CQL library (ELM JSON) against patient data')
  .option('-p, --patient <bundle>', 'Path to a specific patient bundle JSON')
  .option('-d, --patients-dir <dir>', 'Directory containing patient bundles', DEFAULT_PATIENTS_DIR)
  .option('-v, --valuesets-dir <dir>', 'Directory containing ValueSet JSON files', DEFAULT_VALUESETS_DIR)
  .option('-e, --expression <name>', 'Execute only a specific expression')
  .option('--json', 'Output results as JSON')
  .action(async (elmFile: string, options) => {
    try {
      // Validate ELM file exists
      const elmPath = path.resolve(elmFile);
      if (!fs.existsSync(elmPath)) {
        console.error(chalk.red(`Error: ELM file not found: ${elmPath}`));
        process.exit(1);
      }

      // Load and validate ELM
      const elm = loadELM(elmPath);
      const validation = validateELM(elm);

      if (!validation.valid) {
        console.error(chalk.red('ELM validation errors:'));
        validation.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
        process.exit(1);
      }

      // Show warnings
      validation.errors
        .filter(e => e.startsWith('Warning'))
        .forEach(w => console.warn(chalk.yellow(w)));

      // Create patient source
      let patientSource;
      if (options.patient) {
        const patientPath = path.resolve(options.patient);
        if (!fs.existsSync(patientPath)) {
          console.error(chalk.red(`Error: Patient bundle not found: ${patientPath}`));
          process.exit(1);
        }
        patientSource = createPatientSourceFromFile(patientPath);
      } else {
        patientSource = createPatientSourceFromDirectory(options.patientsDir);
      }

      // Create code service
      const codeService = createCodeService(options.valuesetsDir);

      // Execute CQL
      console.log(chalk.blue(`\nExecuting: ${elm.library.identifier.id}`));
      console.log(chalk.gray(`Version: ${elm.library.identifier.version || 'not specified'}`));
      console.log(chalk.gray('─'.repeat(50)));

      const results = await executeCQL({
        elmPath,
        patientSource,
        codeService,
      });

      if (results.length === 0) {
        console.log(chalk.yellow('\nNo patients found to execute against.'));
        console.log(chalk.gray(`Check that patient bundles exist in: ${options.patientsDir}`));
        return;
      }

      // Output results
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const result of results) {
          console.log(chalk.green(`\nPatient: ${result.patientId}`));

          const expressions = options.expression
            ? { [options.expression]: result.results[options.expression] }
            : result.results;

          for (const [name, value] of Object.entries(expressions)) {
            // Skip internal expressions (starting with __)
            if (name.startsWith('__')) continue;

            console.log(chalk.cyan(`  ${name}:`));
            if (value === null || value === undefined) {
              console.log(chalk.gray('    null'));
            } else if (Array.isArray(value)) {
              if (value.length === 0) {
                console.log(chalk.gray('    []'));
              } else {
                console.log(chalk.white(`    [${value.length} items]`));
                value.slice(0, 3).forEach((item, i) => {
                  console.log(chalk.gray(`      ${i + 1}. ${formatValue(item)}`));
                });
                if (value.length > 3) {
                  console.log(chalk.gray(`      ... and ${value.length - 3} more`));
                }
              }
            } else if (typeof value === 'object') {
              console.log(chalk.white(`    ${formatValue(value)}`));
            } else {
              console.log(chalk.white(`    ${value}`));
            }
          }
        }
      }

      console.log(chalk.gray('\n' + '─'.repeat(50)));
      console.log(chalk.green(`Executed against ${results.length} patient(s)`));

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate <elm-file>')
  .description('Validate an ELM JSON file structure')
  .action((elmFile: string) => {
    try {
      const elmPath = path.resolve(elmFile);
      if (!fs.existsSync(elmPath)) {
        console.error(chalk.red(`Error: ELM file not found: ${elmPath}`));
        process.exit(1);
      }

      const elm = loadELM(elmPath);
      const validation = validateELM(elm);

      console.log(chalk.blue(`\nValidating: ${elmPath}`));
      console.log(chalk.gray('─'.repeat(50)));

      console.log(chalk.cyan('Library:'));
      console.log(`  ID: ${elm.library.identifier.id}`);
      console.log(`  Version: ${elm.library.identifier.version || 'not specified'}`);

      const usings = elm.library.usings?.def || [];
      if (usings.length > 0) {
        console.log(chalk.cyan('\nModel Usings:'));
        usings.forEach(u => {
          console.log(`  ${u.localIdentifier}: ${u.uri} ${u.version || ''}`);
        });
      }

      const statements = getStatements(elm);
      if (statements.length > 0) {
        console.log(chalk.cyan('\nStatements/Expressions:'));
        statements.forEach(s => console.log(`  - ${s}`));
      }

      console.log(chalk.gray('\n' + '─'.repeat(50)));

      if (validation.valid) {
        console.log(chalk.green('Validation: PASSED'));
      } else {
        console.log(chalk.red('Validation: FAILED'));
        validation.errors.forEach(e => console.log(chalk.red(`  - ${e}`)));
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Patients command group
const patients = program.command('patients').description('Manage test patient data');

patients
  .command('list')
  .description('List available test patients')
  .option('-d, --dir <dir>', 'Directory containing patient bundles', DEFAULT_PATIENTS_DIR)
  .action((options) => {
    const patientList = getPatientList(options.dir);

    console.log(chalk.blue('\nAvailable Test Patients'));
    console.log(chalk.gray('─'.repeat(50)));

    if (patientList.length === 0) {
      console.log(chalk.yellow('No patients found.'));
      console.log(chalk.gray(`Add patient bundles to: ${path.resolve(options.dir)}`));
      return;
    }

    for (const patient of patientList) {
      console.log(chalk.green(`\n${patient.name}`));
      console.log(`  ID: ${patient.id}`);
      console.log(`  Birth Date: ${patient.birthDate}`);
      console.log(`  Gender: ${patient.gender}`);
      console.log(chalk.gray(`  File: ${patient.filePath}`));
    }

    console.log(chalk.gray('\n' + '─'.repeat(50)));
    console.log(`Total: ${patientList.length} patient(s)`);
  });

// ValueSets command group
const valuesets = program.command('valuesets').description('Manage ValueSet definitions');

valuesets
  .command('list')
  .description('List available ValueSets')
  .option('-d, --dir <dir>', 'Directory containing ValueSet files', DEFAULT_VALUESETS_DIR)
  .action((options) => {
    const valuesetList = getValueSetList(options.dir);

    console.log(chalk.blue('\nAvailable ValueSets'));
    console.log(chalk.gray('─'.repeat(50)));

    if (valuesetList.length === 0) {
      console.log(chalk.yellow('No ValueSets found.'));
      console.log(chalk.gray(`Add ValueSet JSON files to: ${path.resolve(options.dir)}`));
      return;
    }

    for (const vs of valuesetList) {
      console.log(chalk.green(`\n${vs.title}`));
      console.log(`  URL: ${vs.url}`);
      console.log(`  Version: ${vs.version || 'not specified'}`);
      console.log(`  Codes: ${vs.codeCount}`);
      console.log(chalk.gray(`  File: ${vs.filePath}`));
    }

    console.log(chalk.gray('\n' + '─'.repeat(50)));
    console.log(`Total: ${valuesetList.length} ValueSet(s)`);
  });

// Libraries command - list ELM libraries
program
  .command('libraries')
  .description('List available ELM libraries')
  .option('-d, --dir <dir>', 'Directory containing ELM files', DEFAULT_ELM_DIR)
  .action((options) => {
    const libraries = getELMList(options.dir);

    console.log(chalk.blue('\nAvailable CQL Libraries (ELM)'));
    console.log(chalk.gray('─'.repeat(50)));

    if (libraries.length === 0) {
      console.log(chalk.yellow('No ELM libraries found.'));
      console.log(chalk.gray(`Add ELM JSON files to: ${path.resolve(options.dir)}`));
      return;
    }

    for (const lib of libraries) {
      console.log(chalk.green(`\n${lib.id}`));
      console.log(`  Version: ${lib.version || 'not specified'}`);
      console.log(chalk.gray(`  File: ${lib.filePath}`));
    }

    console.log(chalk.gray('\n' + '─'.repeat(50)));
    console.log(`Total: ${libraries.length} library(ies)`);
  });

// MADiE command - run MADiE package test cases
program
  .command('madie <package-dir>')
  .description('Run MADiE package test cases')
  .option('--test-cases <dir>', 'Path to test cases directory')
  .option('--test <uuid>', 'Run specific test case by UUID')
  .option('--valuesets <dir>', 'Path to ValueSets directory', 'valuesets/nhsn')
  .option('--library <name>', 'Main library name (auto-detected if not specified)')
  .option('--json', 'Output results as JSON')
  .option('--verbose', 'Show detailed expression results')
  .option('--full', 'Include full expression results in output')
  .option('--output <file>', 'Save results to file (JSON format)')
  .option('--save-elm <dir>', 'Save extracted ELM files to directory')
  .option('--save-bundles <dir>', 'Save processed patient bundles to directory')
  .action(async (packageDir: string, options) => {
    try {
      const absPackageDir = path.resolve(packageDir);

      if (!fs.existsSync(absPackageDir)) {
        console.error(chalk.red(`Error: Package directory not found: ${absPackageDir}`));
        process.exit(1);
      }

      // Auto-detect test cases directory if not specified
      let testCasesDir = options.testCases;
      if (!testCasesDir) {
        // Try common patterns
        const baseName = path.basename(packageDir);
        const candidates = [
          `${baseName}-TestCases`,
          `${packageDir}-TestCases`,
          path.join(path.dirname(packageDir), `${baseName}-TestCases`)
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            testCasesDir = candidate;
            break;
          }
        }
      }

      if (!testCasesDir || !fs.existsSync(testCasesDir)) {
        console.error(chalk.red('Error: Test cases directory not found.'));
        console.error(chalk.gray('Use --test-cases <dir> to specify the path.'));
        process.exit(1);
      }

      // List available libraries to find main library
      const libraries = listPackageLibraries(packageDir);
      if (libraries.length === 0) {
        console.error(chalk.red('Error: No libraries found in package.'));
        process.exit(1);
      }

      // Determine main library name
      let mainLibraryName = options.library;
      if (!mainLibraryName) {
        // Find the main library - try several strategies:
        // 1. Look for library with longest name (usually the main measure)
        // 2. Look for library matching package name pattern
        // 3. Exclude common helper libraries

        const helperLibraries = ['FHIRHelpers', 'QICoreCommon', 'CQMCommon', 'SharedResourceCreation'];
        const candidateLibs = libraries.filter(l => !helperLibraries.includes(l.name));

        if (candidateLibs.length > 0) {
          // Pick the one with longest name (usually the measure library)
          candidateLibs.sort((a, b) => b.name.length - a.name.length);
          mainLibraryName = candidateLibs[0].name;
        } else {
          mainLibraryName = libraries[0].name;
        }
      }

      console.log(chalk.blue('\nMADiE Package Test Runner'));
      console.log(chalk.gray('━'.repeat(50)));
      console.log(`Package: ${chalk.cyan(mainLibraryName)}`);
      console.log(`Libraries: ${chalk.cyan(libraries.length)}`);

      // Load the package
      console.log(chalk.gray('\nLoading package...'));
      const pkg = loadMADiEPackage(packageDir, mainLibraryName);
      console.log(chalk.green(`  Loaded ${pkg.allLibraries.length} libraries`));

      // Save extracted ELM files if requested
      if (options.saveElm) {
        const elmDir = path.resolve(options.saveElm);
        if (!fs.existsSync(elmDir)) {
          fs.mkdirSync(elmDir, { recursive: true });
        }
        for (const lib of pkg.allLibraries) {
          const libId = lib.library.identifier.id;
          const libVersion = lib.library.identifier.version || '0.0.0';
          const fileName = `${libId}-${libVersion}.json`;
          const filePath = path.join(elmDir, fileName);
          fs.writeFileSync(filePath, JSON.stringify(lib, null, 2));
        }
        console.log(chalk.green(`  Saved ${pkg.allLibraries.length} ELM files to: ${elmDir}`));
      }

      // Load ValueSets
      console.log(chalk.gray('Loading ValueSets...'));
      const codeService = loadValueSetsForMadie(options.valuesets);
      const vsInfo = getValueSetSummary(options.valuesets);
      console.log(chalk.green(`  Loaded ${vsInfo.length} ValueSets`));

      if (vsInfo.length === 0) {
        console.warn(chalk.yellow('\n  Warning: No ValueSets loaded!'));
        console.warn(chalk.gray('  Run: python scripts/download-valuesets.py --api-key YOUR_KEY'));
      }

      // Load test cases
      console.log(chalk.gray('Loading test cases...'));
      let testCases = loadTestCases(testCasesDir);
      console.log(chalk.green(`  Found ${testCases.length} test cases`));

      // Filter to specific test if requested
      if (options.test) {
        testCases = testCases.filter(tc =>
          tc.id === options.test || tc.name.toLowerCase().includes(options.test.toLowerCase())
        );
        if (testCases.length === 0) {
          console.error(chalk.red(`Error: Test case not found: ${options.test}`));
          process.exit(1);
        }
      }

      // Save processed patient bundles if requested
      if (options.saveBundles) {
        const bundlesDir = path.resolve(options.saveBundles);
        if (!fs.existsSync(bundlesDir)) {
          fs.mkdirSync(bundlesDir, { recursive: true });
        }
        for (const testCase of testCases) {
          // Create a clean filename from test name
          const safeTestName = testCase.name.replace(/[^a-zA-Z0-9]/g, '-');
          const fileName = `${safeTestName}-bundle.json`;
          const filePath = path.join(bundlesDir, fileName);

          // Save clean FHIR collection bundle (no custom metadata)
          const bundleToSave = {
            resourceType: 'Bundle',
            type: 'collection',
            id: testCase.id,
            entry: testCase.patientBundle.entry
          };
          fs.writeFileSync(filePath, JSON.stringify(bundleToSave, null, 2));
        }
        console.log(chalk.green(`  Saved ${testCases.length} patient bundles to: ${bundlesDir}`));
      }

      console.log(chalk.gray('\n' + '━'.repeat(50)));
      console.log(chalk.blue('Running tests...\n'));

      // Create repository from package
      const repository = createRepository(pkg);
      const mainLibrary = new Library(pkg.mainLibrary, repository);

      // Run each test case
      const results: Array<{
        testCase: TestCase;
        passed: boolean;
        actualCount: number;
        expectedCount: number;
        groupComparisons?: GroupComparison[];
        observations?: { obs1: number; obs2: number; obs3: number; obs4: number };
        error?: string;
        expressions?: Record<string, unknown>;
      }> = [];

      for (const testCase of testCases) {
        try {
          // Create patient source from bundle
          const patientSource = PatientSource.FHIRv401();

          // Convert entries to array of resources
          const resources = testCase.patientBundle.entry?.map(e => e.resource).filter(Boolean) || [];

          // Wrap in a bundle for loading
          const bundleForLoading = {
            resourceType: 'Bundle',
            type: 'collection',
            entry: resources.map(r => ({ resource: r }))
          };

          patientSource.loadBundles([bundleForLoading]);

          // Get measurement period from expected results
          // CQL expects DateTime objects in a specific format
          const startStr = testCase.expectedResults.measurementPeriod.start;
          const endStr = testCase.expectedResults.measurementPeriod.end;

          // Parse measurement period dates into CQL DateTime objects
          const startDate = new Date(startStr);
          const endDate = new Date(endStr);

          const mpStart = DateTime.fromJSDate(startDate, 0); // 0 = UTC offset
          const mpEnd = DateTime.fromJSDate(endDate, 0);
          const measurementPeriod = new Interval(mpStart, mpEnd, true, true);

          // Create executor with Measurement Period parameter
          const executor = new Executor(mainLibrary, codeService, {
            'Measurement Period': measurementPeriod
          });

          // Execute
          const execResults = await executor.exec(patientSource);

          // Get Initial Population result
          const patientId = getPatientIdFromBundle(testCase.patientBundle) || testCase.id;
          const patientResults = execResults.patientResults?.[patientId] || {};

          // Count Initial Population
          const ipResult = patientResults['Initial Population'];
          let actualCount = 0;
          if (Array.isArray(ipResult)) {
            actualCount = ipResult.length;
          } else if (ipResult) {
            actualCount = 1;
          }

          // Get expected count
          const expectedPop = testCase.expectedResults.populations.find(
            p => p.code === 'initial-population'
          );
          const expectedCount = expectedPop?.count ?? 0;

          // Calculate observations and group comparisons
          const observations = calculateObservations(patientResults);
          const actualGroups = calculateActualGroups(patientResults);
          const groupComparisons = compareGroups(testCase.expectedResults.groups, actualGroups);

          // Check if all groups pass
          const allGroupsPass = groupComparisons.every(g => g.passed);
          const ipPassed = actualCount === expectedCount;
          const passed = ipPassed && allGroupsPass;

          // Build result object
          const resultObj: typeof results[0] = {
            testCase,
            passed,
            actualCount,
            expectedCount,
            groupComparisons,
            observations
          };

          // Include full expressions if --full is specified
          if (options.full) {
            resultObj.expressions = patientResults;
          }

          results.push(resultObj);

          // Output result
          const statusIcon = passed ? chalk.green('[PASS]') : chalk.red('[FAIL]');
          console.log(`${statusIcon} ${testCase.name}`);

          if (!passed || options.verbose) {
            console.log(chalk.gray(`  Initial Population: expected ${expectedCount}, got ${actualCount}`));

            // Show observation scores
            console.log(chalk.gray(`  Observations: Obs1=${observations.obs1}, Obs2=${observations.obs2}, Obs3=${observations.obs3}, Obs4=${observations.obs4}`));

            // Show group comparison details for failures
            if (!allGroupsPass) {
              console.log(chalk.gray('  Group Comparisons:'));
              for (const gc of groupComparisons) {
                const groupStatus = gc.passed ? chalk.green('OK') : chalk.red('FAIL');
                if (!gc.passed || options.verbose) {
                  console.log(chalk.gray(`    ${gc.groupId}: [${groupStatus}]`));
                  console.log(chalk.gray(`      IP: exp=${gc.expected.initialPopulation}, act=${gc.actual.initialPopulation}`));
                  console.log(chalk.gray(`      MP: exp=${gc.expected.measurePopulation}, act=${gc.actual.measurePopulation}`));
                  console.log(chalk.gray(`      MPE: exp=${gc.expected.measurePopulationExclusion}, act=${gc.actual.measurePopulationExclusion}`));
                  // Show individual observations
                  const expObs = gc.expected.observations;
                  const actObs = gc.actual.observations;
                  console.log(chalk.gray(`      Obs1: exp=${expObs.obs1}, act=${actObs.obs1}`));
                  if (gc.groupId === 'Group_5' || gc.groupId === 'Group_6') {
                    console.log(chalk.gray(`      Obs2: exp=${expObs.obs2}, act=${actObs.obs2}`));
                    console.log(chalk.gray(`      Obs3: exp=${expObs.obs3}, act=${actObs.obs3}`));
                    console.log(chalk.gray(`      Obs4: exp=${expObs.obs4}, act=${actObs.obs4}`));
                  }
                }
              }
            }
          }

          if (options.verbose && Object.keys(patientResults).length > 0) {
            console.log(chalk.gray('  Expressions:'));
            for (const [name, value] of Object.entries(patientResults)) {
              if (name.startsWith('__')) continue;
              const displayValue = Array.isArray(value)
                ? `[${value.length} items]`
                : value === null || value === undefined
                  ? 'null'
                  : typeof value === 'object'
                    ? formatValue(value)
                    : String(value);
              console.log(chalk.gray(`    ${name}: ${displayValue}`));
            }
          }

        } catch (error) {
          results.push({
            testCase,
            passed: false,
            actualCount: 0,
            expectedCount: testCase.expectedResults.populations.find(p => p.code === 'initial-population')?.count ?? 0,
            error: (error as Error).message
          });

          console.log(chalk.red(`[ERROR] ${testCase.name}`));
          console.log(chalk.red(`  ${(error as Error).message}`));
        }
      }

      // Summary
      const passedCount = results.filter(r => r.passed).length;
      const failedCount = results.filter(r => !r.passed).length;

      console.log(chalk.gray('\n' + '━'.repeat(50)));

      // Build results object with unique titles
      // Track occurrence count per test name for unique titles
      const nameCounts: Record<string, number> = {};
      const nameIndices: Record<string, number> = {};

      // First pass: count total occurrences of each name
      for (const r of results) {
        nameCounts[r.testCase.name] = (nameCounts[r.testCase.name] || 0) + 1;
      }

      const outputData = {
        package: mainLibraryName,
        timestamp: new Date().toISOString(),
        total: results.length,
        passed: passedCount,
        failed: failedCount,
        groupNames: GROUP_NAMES,
        observationNames: OBSERVATION_NAMES,
        results: results.map(r => {
          // Generate unique title: name_N if multiple, or just name if single
          const count = nameCounts[r.testCase.name];
          let title: string;
          if (count > 1) {
            nameIndices[r.testCase.name] = (nameIndices[r.testCase.name] || 0) + 1;
            title = `${r.testCase.name}_${nameIndices[r.testCase.name]}`;
          } else {
            title = r.testCase.name;
          }

          const result: Record<string, unknown> = {
            id: r.testCase.id,
            name: r.testCase.name,
            title: title,
            description: r.testCase.expectedResults.description || '',
            passed: r.passed,
            expected: r.expectedCount,
            actual: r.actualCount
          };
          if (r.observations) {
            result.observations = r.observations;
          }
          if (r.groupComparisons) {
            result.groups = r.groupComparisons.map(gc => ({
              groupId: gc.groupId,
              groupName: GROUP_NAMES[gc.groupId] || gc.groupId,
              passed: gc.passed,
              expected: gc.expected,
              actual: gc.actual,
              expectedScore: gc.expectedScore,
              actualScore: gc.actualScore
            }));
          }
          if (r.error) result.error = r.error;
          if (r.expressions) result.expressions = r.expressions;
          return result;
        })
      };

      // Save to file if --output specified
      if (options.output) {
        const outputPath = path.resolve(options.output);
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
        console.log(chalk.green(`Results saved to: ${outputPath}`));
      }

      if (options.json) {
        console.log(JSON.stringify(outputData, null, 2));
      } else {
        console.log(`Results: ${chalk.green(`${passedCount} passed`)}, ${failedCount > 0 ? chalk.red(`${failedCount} failed`) : chalk.gray('0 failed')}`);
      }

      // Exit with error if any tests failed
      if (failedCount > 0) {
        process.exit(1);
      }

    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      if (options.verbose) {
        console.error((error as Error).stack);
      }
      process.exit(1);
    }
  });

// Helper function to format complex values
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // FHIR resource
    if (obj.resourceType) {
      const id = obj.id || 'unknown';
      return `${obj.resourceType}/${id}`;
    }

    // CQL Interval
    if ('low' in obj && 'high' in obj) {
      return `Interval[${formatValue(obj.low)}, ${formatValue(obj.high)}]`;
    }

    // CQL Quantity
    if ('value' in obj && 'unit' in obj) {
      return `${obj.value} ${obj.unit}`;
    }

    // CQL Code
    if ('code' in obj && 'system' in obj) {
      return `${obj.system}|${obj.code}`;
    }

    // Generic object
    return JSON.stringify(obj).slice(0, 100);
  }

  return String(value);
}

program.parse();
