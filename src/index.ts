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
} from './madie/test-bundle-processor.js';
import {
  loadValueSetsForMadie,
  getValueSetSummary,
} from './madie/valueset-loader.js';
import { PatientSource } from 'cql-exec-fhir';
import { Library, Executor } from 'cql-execution';

const program = new Command();

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

          // Save the processed collection bundle
          const bundleToSave = {
            resourceType: 'Bundle',
            type: 'collection',
            id: testCase.id,
            meta: {
              testName: testCase.name,
              expectedResults: testCase.expectedResults
            },
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

          // Create executor - pass null for parameters to use CQL defaults
          // The CQL has a default Measurement Period defined
          const executor = new Executor(mainLibrary, codeService, undefined);

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

          const passed = actualCount === expectedCount;

          // Build result object
          const resultObj: typeof results[0] = {
            testCase,
            passed,
            actualCount,
            expectedCount
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

      // Build results object
      const outputData = {
        package: mainLibraryName,
        timestamp: new Date().toISOString(),
        total: results.length,
        passed: passedCount,
        failed: failedCount,
        results: results.map(r => {
          const result: Record<string, unknown> = {
            id: r.testCase.id,
            name: r.testCase.name,
            passed: r.passed,
            expected: r.expectedCount,
            actual: r.actualCount
          };
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
