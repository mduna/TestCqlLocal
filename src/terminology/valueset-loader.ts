import { CodeService } from 'cql-execution';
import * as fs from 'fs';
import * as path from 'path';

export interface ValueSetCoding {
  system: string;
  code: string;
  display?: string;
}

export interface ValueSetExpansion {
  contains?: ValueSetCoding[];
}

export interface ValueSetCompose {
  include?: Array<{
    system?: string;
    concept?: Array<{
      code: string;
      display?: string;
    }>;
    valueSet?: string[];
  }>;
}

export interface FHIRValueSet {
  resourceType: 'ValueSet';
  id?: string;
  url: string;
  name?: string;
  title?: string;
  version?: string;
  status: string;
  expansion?: ValueSetExpansion;
  compose?: ValueSetCompose;
}

export interface ValueSetInfo {
  url: string;
  name: string;
  title: string;
  version?: string;
  codeCount: number;
  filePath: string;
}

/**
 * Load a ValueSet from a JSON file
 */
export function loadValueSet(filePath: string): FHIRValueSet {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  return JSON.parse(content) as FHIRValueSet;
}

/**
 * Load all ValueSets from a directory
 */
export function loadAllValueSets(valuesetDir: string): FHIRValueSet[] {
  const absoluteDir = path.resolve(valuesetDir);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const files = fs.readdirSync(absoluteDir).filter(f => f.endsWith('.json'));
  const valuesets: FHIRValueSet[] = [];

  for (const file of files) {
    try {
      const vs = loadValueSet(path.join(absoluteDir, file));
      if (vs.resourceType === 'ValueSet') {
        valuesets.push(vs);
      }
    } catch {
      // Skip invalid files
    }
  }

  return valuesets;
}

/**
 * Get list of available ValueSets
 */
export function getValueSetList(valuesetDir: string): ValueSetInfo[] {
  const absoluteDir = path.resolve(valuesetDir);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const files = fs.readdirSync(absoluteDir).filter(f => f.endsWith('.json'));
  const valuesets: ValueSetInfo[] = [];

  for (const file of files) {
    try {
      const vs = loadValueSet(path.join(absoluteDir, file));
      if (vs.resourceType === 'ValueSet') {
        valuesets.push({
          url: vs.url,
          name: vs.name || 'Unknown',
          title: vs.title || vs.name || 'Unknown',
          version: vs.version,
          codeCount: countCodes(vs),
          filePath: file,
        });
      }
    } catch {
      // Skip invalid files
    }
  }

  return valuesets;
}

/**
 * Count codes in a ValueSet
 */
function countCodes(vs: FHIRValueSet): number {
  // Count from expansion if available
  if (vs.expansion?.contains) {
    return vs.expansion.contains.length;
  }

  // Count from compose
  let count = 0;
  if (vs.compose?.include) {
    for (const include of vs.compose.include) {
      if (include.concept) {
        count += include.concept.length;
      }
    }
  }

  return count;
}

interface CqlCode {
  code: string;
  system: string;
  version: string;
}

type CodeServiceFormat = Record<string, Record<string, CqlCode[]>>;

/**
 * Convert ValueSet to CQL CodeService format
 * Format: { valueSetUrl: { version: [{ code, system, version }] } }
 */
export function valueSetToCqlFormat(vs: FHIRValueSet): CodeServiceFormat {
  const codes: CqlCode[] = [];

  // Get codes from expansion
  if (vs.expansion?.contains) {
    for (const coding of vs.expansion.contains) {
      codes.push({
        system: coding.system,
        code: coding.code,
        version: '',
      });
    }
  }

  // Get codes from compose if no expansion
  if (codes.length === 0 && vs.compose?.include) {
    for (const include of vs.compose.include) {
      if (include.concept && include.system) {
        for (const concept of include.concept) {
          codes.push({
            system: include.system,
            code: concept.code,
            version: '',
          });
        }
      }
    }
  }

  // Format: { valueSetUrl: { version: codes } }
  const version = vs.version || '';
  return {
    [vs.url]: {
      [version]: codes,
    },
  };
}

/**
 * Create a CodeService from local ValueSet files
 */
export function createCodeService(valuesetDir: string): CodeService {
  const valuesets = loadAllValueSets(valuesetDir);

  // Build valueset map in CodeService format
  const valueSetMap: CodeServiceFormat = {};

  for (const vs of valuesets) {
    const converted = valueSetToCqlFormat(vs);
    // Merge into the map
    for (const [url, versions] of Object.entries(converted)) {
      if (!valueSetMap[url]) {
        valueSetMap[url] = {};
      }
      Object.assign(valueSetMap[url], versions);
    }
  }

  // Create CodeService with the valueset data
  return new CodeService(valueSetMap);
}

/**
 * Check if a code is in a ValueSet
 */
export function codeInValueSet(
  code: string,
  system: string,
  valuesetUrl: string,
  valuesetDir: string
): boolean {
  const valuesets = loadAllValueSets(valuesetDir);
  const vs = valuesets.find(v => v.url === valuesetUrl);

  if (!vs) {
    return false;
  }

  const converted = valueSetToCqlFormat(vs)[valuesetUrl] || {};
  const version = vs.version || '';
  const codes: CqlCode[] = converted[version] || [];
  return codes.some((c: CqlCode) => c.code === code && c.system === system);
}
