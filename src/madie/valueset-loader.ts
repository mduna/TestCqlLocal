/**
 * ValueSet Loader for MADiE Package Testing
 *
 * Loads ValueSets from VSAC cache directory and creates CodeService.
 * This is a wrapper around the existing terminology loader.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CodeService } from 'cql-execution';
import { createCodeService, loadAllValueSets, getValueSetList, ValueSetInfo } from '../terminology/valueset-loader.js';

/**
 * Default VSAC cache directory for NHSN valuesets
 */
export const DEFAULT_VALUESET_DIR = 'valuesets/nhsn';

/**
 * Load ValueSets and create a CodeService for CQL execution.
 *
 * @param valuesetDir - Directory containing VSAC ValueSet JSON files
 * @returns CodeService instance for use with cql-execution
 */
export function loadValueSetsForMadie(valuesetDir: string = DEFAULT_VALUESET_DIR): CodeService {
  const absoluteDir = path.resolve(valuesetDir);

  if (!fs.existsSync(absoluteDir)) {
    console.warn(`Warning: ValueSet directory not found: ${absoluteDir}`);
    console.warn('Run scripts/download-valuesets.py to download required ValueSets');
    // Return empty CodeService
    return new CodeService({});
  }

  const valuesets = loadAllValueSets(absoluteDir);

  if (valuesets.length === 0) {
    console.warn(`Warning: No ValueSets found in ${absoluteDir}`);
    console.warn('Run scripts/download-valuesets.py to download required ValueSets');
    return new CodeService({});
  }

  return createCodeService(absoluteDir);
}

/**
 * Check if required ValueSets are available.
 *
 * @param requiredOids - Array of required ValueSet OIDs
 * @param valuesetDir - Directory containing ValueSet files
 * @returns Object with available and missing ValueSet OIDs
 */
export function checkValueSets(
  requiredOids: string[],
  valuesetDir: string = DEFAULT_VALUESET_DIR
): { available: string[]; missing: string[] } {
  const absoluteDir = path.resolve(valuesetDir);

  if (!fs.existsSync(absoluteDir)) {
    return { available: [], missing: requiredOids };
  }

  const vsInfo: ValueSetInfo[] = getValueSetList(absoluteDir);
  const availableUrls = new Set(vsInfo.map((vs: ValueSetInfo) => vs.url));

  const available: string[] = [];
  const missing: string[] = [];

  for (const oid of requiredOids) {
    // Build possible URLs for the OID
    const possibleUrls = [
      `http://cts.nlm.nih.gov/fhir/ValueSet/${oid}`,
      oid // In case it's already a full URL
    ];

    const found = possibleUrls.some(url => availableUrls.has(url));
    if (found) {
      available.push(oid);
    } else {
      missing.push(oid);
    }
  }

  return { available, missing };
}

/**
 * Get summary of available ValueSets.
 *
 * @param valuesetDir - Directory containing ValueSet files
 * @returns Array of ValueSet summaries
 */
export function getValueSetSummary(valuesetDir: string = DEFAULT_VALUESET_DIR): Array<{
  name: string;
  oid: string;
  codeCount: number;
}> {
  const absoluteDir = path.resolve(valuesetDir);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const vsInfo: ValueSetInfo[] = getValueSetList(absoluteDir);

  return vsInfo.map((vs: ValueSetInfo) => {
    // Extract OID from URL
    const oid = vs.url.includes('/ValueSet/')
      ? vs.url.split('/ValueSet/')[1]
      : vs.url;

    return {
      name: vs.title || vs.name,
      oid,
      codeCount: vs.codeCount
    };
  });
}
