/**
 * MADiE Package Loader
 *
 * Loads all FHIR Library resources from a MADiE package export
 * and builds a cql-execution Repository with all libraries.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Repository } from 'cql-execution';
import { ELMLibrary } from '../engine/cql-runner.js';
import { extractELMFromFHIRLibrary, getLibraryInfo } from './elm-extractor.js';

/**
 * Group metadata from Measure resource
 */
export interface MeasureGroup {
  id: string;
  description: string | null;
  hasObservations: boolean;
}

/**
 * Measure metadata
 */
export interface MeasureMetadata {
  name: string;
  version: string;
  groups: MeasureGroup[];
  groupCount: number;
}

/**
 * MADiE package structure
 */
export interface MADiEPackage {
  mainLibrary: ELMLibrary;
  dependentLibraries: ELMLibrary[];
  allLibraries: ELMLibrary[];
  valueSetUrls: string[];
  measureMetadata: MeasureMetadata | null;
}

/**
 * Library metadata
 */
interface LibraryMetadata {
  filePath: string;
  name: string;
  version: string;
}

/**
 * Load a MADiE package from a directory.
 *
 * @param packageDir - Path to the MADiE package directory (e.g., NHSNACHMonthly1-v0.0.000-FHIR)
 * @param mainLibraryName - Name of the main library (e.g., "NHSNAcuteCareHospitalMonthlyInitialPopulation1")
 * @returns The loaded package with all libraries
 */
export function loadMADiEPackage(packageDir: string, mainLibraryName: string): MADiEPackage {
  const resourcesDir = path.join(packageDir, 'resources');

  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`Resources directory not found: ${resourcesDir}`);
  }

  // Find all library files
  const files = fs.readdirSync(resourcesDir).filter(f =>
    f.startsWith('library-') && f.endsWith('.json')
  );

  if (files.length === 0) {
    throw new Error(`No library files found in ${resourcesDir}`);
  }

  // Get metadata for all libraries first
  const libraryMeta: LibraryMetadata[] = [];
  for (const file of files) {
    try {
      const filePath = path.join(resourcesDir, file);
      const info = getLibraryInfo(filePath);
      libraryMeta.push({
        filePath,
        name: info.name,
        version: info.version
      });
    } catch (err) {
      console.warn(`Warning: Could not read library metadata from ${file}:`, err);
    }
  }

  // Find the main library
  const mainLibMeta = libraryMeta.find(l => l.name === mainLibraryName);
  if (!mainLibMeta) {
    const available = libraryMeta.map(l => l.name).join(', ');
    throw new Error(
      `Main library "${mainLibraryName}" not found. Available: ${available}`
    );
  }

  // Extract ELM from all libraries
  const allLibraries: ELMLibrary[] = [];
  let mainLibrary: ELMLibrary | null = null;

  for (const meta of libraryMeta) {
    try {
      const elm = extractELMFromFHIRLibrary(meta.filePath);
      allLibraries.push(elm);

      if (meta.name === mainLibraryName) {
        mainLibrary = elm;
      }
    } catch (err) {
      console.warn(`Warning: Could not extract ELM from ${meta.name}:`, err);
    }
  }

  if (!mainLibrary) {
    throw new Error(`Failed to extract main library "${mainLibraryName}"`);
  }

  // Separate dependent libraries
  const dependentLibraries = allLibraries.filter(
    lib => lib.library.identifier.id !== mainLibraryName
  );

  // Extract ValueSet URLs from the main library
  const valueSetUrls = extractValueSetUrls(mainLibrary);

  // Load Measure metadata for group names
  const measureMetadata = loadMeasureMetadata(resourcesDir);

  return {
    mainLibrary,
    dependentLibraries,
    allLibraries,
    valueSetUrls,
    measureMetadata
  };
}

/**
 * Load Measure resource and extract group metadata.
 *
 * @param resourcesDir - Path to the resources directory
 * @returns Measure metadata or null if not found
 */
function loadMeasureMetadata(resourcesDir: string): MeasureMetadata | null {
  // Find measure file
  const files = fs.readdirSync(resourcesDir).filter(f =>
    f.startsWith('measure-') && f.endsWith('.json')
  );

  if (files.length === 0) {
    return null;
  }

  try {
    const measurePath = path.join(resourcesDir, files[0]);
    const content = fs.readFileSync(measurePath, 'utf-8');
    const measure = JSON.parse(content);

    if (measure.resourceType !== 'Measure') {
      return null;
    }

    const groups: MeasureGroup[] = [];

    if (Array.isArray(measure.group)) {
      for (const group of measure.group) {
        // Check if group has observations by looking at population types
        let hasObservations = false;
        if (Array.isArray(group.population)) {
          hasObservations = group.population.some((pop: any) => {
            const code = pop.code?.coding?.[0]?.code;
            return code === 'measure-observation' || code === 'measure-population-observation';
          });
        }

        groups.push({
          id: group.id || `Group_${groups.length + 1}`,
          description: group.description?.trim() || null,
          hasObservations
        });
      }
    }

    return {
      name: measure.name || measure.title || 'Unknown',
      version: measure.version || '0.0.0',
      groups,
      groupCount: groups.length
    };
  } catch (err) {
    console.warn('Warning: Could not load Measure metadata:', err);
    return null;
  }
}

/**
 * Extract ValueSet URLs from an ELM library.
 */
function extractValueSetUrls(elm: ELMLibrary): string[] {
  const urls: string[] = [];

  // Look in valueSets section
  const valueSets = (elm.library as any).valueSets?.def;
  if (Array.isArray(valueSets)) {
    for (const vs of valueSets) {
      if (vs.id) {
        urls.push(vs.id);
      }
    }
  }

  return urls;
}

/**
 * Create a cql-execution Repository from a MADiE package.
 *
 * @param pkg - The loaded MADiE package
 * @returns A Repository containing all libraries
 */
export function createRepository(pkg: MADiEPackage): Repository {
  return new Repository(pkg.allLibraries);
}

/**
 * List available libraries in a MADiE package directory.
 *
 * @param packageDir - Path to the MADiE package directory
 * @returns Array of library names and versions
 */
export function listPackageLibraries(packageDir: string): Array<{ name: string; version: string }> {
  const resourcesDir = path.join(packageDir, 'resources');

  if (!fs.existsSync(resourcesDir)) {
    return [];
  }

  const files = fs.readdirSync(resourcesDir).filter(f =>
    f.startsWith('library-') && f.endsWith('.json')
  );

  const libraries: Array<{ name: string; version: string }> = [];

  for (const file of files) {
    try {
      const info = getLibraryInfo(path.join(resourcesDir, file));
      libraries.push({ name: info.name, version: info.version });
    } catch {
      // Skip invalid files
    }
  }

  return libraries;
}
